import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra,
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestTaskStore } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  LoggingLevel,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { createToolOutputSchema } from '../schemas/outputs.js';

import { createCachedEnvInt } from './config.js';
import {
  createNoDiffError,
  type DiffSlot,
  diffStaleWarningMs,
  getDiff,
  getDiffCacheSlot,
} from './diff.js';
import { validateDiffBudget } from './diff.js';
import { type DiffStats, EMPTY_DIFF_STATS, type ParsedFile } from './diff.js';
import { classifyErrorMeta } from './errors.js';
import { getErrorMessage } from './errors.js';
import {
  createNoFileError,
  type FileSlot,
  getFile,
  validateFileBudget,
} from './file-store.js';
import {
  type GeminiStructuredRequest,
  generateStructuredJson,
  stripJsonSchemaConstraints,
} from './gemini/index.js';
import {
  createFailureStatusMessage,
  DEFAULT_PROGRESS_CONTEXT,
  extractValidationMessage,
  getOrCreateProgressReporter,
  normalizeProgressContext,
  type ProgressExtra,
  type ProgressPayload,
  RunReporter,
  sendSingleStepProgress,
  STEP_BUILDING_PROMPT,
  STEP_CALLING_MODEL,
  STEP_FINALIZING,
  STEP_STARTING,
  STEP_VALIDATING,
  STEP_VALIDATING_RESPONSE,
  type TaskStatusReporter,
} from './progress.js';
import {
  createErrorToolResponse,
  createToolResponse,
} from './tool-response.js';

export * from './tool-response.js';
export * from './tool-contracts.js';

export interface PromptParts {
  systemInstruction: string;
  prompt: string;
}

/**
 * Immutable snapshot of server-side state captured once at the start of a
 * tool execution, before `validateInput` runs.  Threading it through both
 * `validateInput` and `buildPrompt` eliminates the TOCTOU gap that would
 * otherwise allow a concurrent `generate_diff` call to replace the cached
 * diff between the budget check and prompt assembly.
 */
export interface ToolExecutionContext {
  readonly diffSlot: DiffSlot | undefined;
  readonly fileSlot: FileSlot | undefined;
  /** Snapshotted Gemini context cache name for diff-dependent tools. */
  readonly diffCacheSlotName: string | undefined;
}

const DEFAULT_SCHEMA_RETRIES = 1;
const geminiSchemaRetriesConfig = createCachedEnvInt(
  'GEMINI_SCHEMA_RETRIES',
  DEFAULT_SCHEMA_RETRIES
);
const DEFAULT_SCHEMA_RETRY_ERROR_CHARS = 1_500;
const schemaRetryErrorCharsConfig = createCachedEnvInt(
  'MAX_SCHEMA_RETRY_ERROR_CHARS',
  DEFAULT_SCHEMA_RETRY_ERROR_CHARS
);
const DEFAULT_TASK_TTL_MS = 300_000;
const taskTtlMsConfig = createCachedEnvInt('TASK_TTL_MS', DEFAULT_TASK_TTL_MS);
const DETERMINISTIC_JSON_RETRY_NOTE =
  'Deterministic JSON mode: keep key names exactly as schema-defined and preserve stable field ordering.';
const COMPLETED_STATUS_PREFIX = 'completed: ';
const STALE_DIFF_WARNING_PREFIX = '\n\nWarning: The analyzed diff is over ';
const STALE_DIFF_WARNING_SUFFIX =
  ' minutes old. If you have made recent changes, please run generate_diff again.';

const JSON_PARSE_ERROR_PATTERN = /model produced invalid json/i;
const responseSchemaCache = new WeakMap<object, Record<string, unknown>>();

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  destructiveHint?: boolean;
}

function buildToolAnnotations(
  annotations: ToolAnnotations | undefined
): ToolAnnotations {
  if (!annotations) {
    return {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    };
  }

  const { destructiveHint, ...annotationOverrides } = annotations;

  return {
    readOnlyHint: !destructiveHint,
    idempotentHint: !destructiveHint,
    openWorldHint: false,
    destructiveHint: destructiveHint ?? false,
    ...annotationOverrides,
  };
}

export interface StructuredToolTaskConfig<
  TInput extends object = Record<string, unknown>,
  TResult extends object = Record<string, unknown>,
  TFinal extends TResult = TResult,
> {
  /** Tool name registered with the MCP server (e.g. 'analyze_pr_impact'). */
  name: string;

  /** Human-readable title shown to clients. */
  title: string;

  /** Short description of the tool's purpose. */
  description: string;

  /** Zod schema or raw shape for MCP request validation at the transport boundary. */
  inputSchema: z.ZodType<TInput> | ZodRawShapeCompat;

  /** Zod schema for validating the complete tool input inside the handler. */
  fullInputSchema: z.ZodType<TInput>;

  /**
   * Zod schema for the final structured result after any transformResult.
   * When geminiSchema is also provided, this is only used for outputSchema
   * derivation — the actual Gemini response is parsed against geminiSchema.
   */
  resultSchema: z.ZodType<TResult>;

  /**
   * Optional Zod schema for parsing and validating the raw Gemini response.
   * When set, Gemini is instructed to produce this shape and the response is
   * parsed against it (instead of resultSchema). The transformResult hook
   * then extends the parsed result into the final TFinal shape.
   */
  geminiSchema?: z.ZodType<TResult>;

  /** Stable error code returned on failure (e.g. 'E_INSPECT_QUALITY'). */
  errorCode: string;

  /** Optional post-processing hook called after resultSchema.parse(). The return value replaces the parsed result. */
  transformResult?: (
    input: TInput,
    result: TResult,
    ctx: ToolExecutionContext
  ) => TFinal;

  /** Optional validation hook for input parameters. */
  validateInput?: (
    input: TInput,
    ctx: ToolExecutionContext
  ) => Promise<ReturnType<typeof createErrorToolResponse> | undefined>;

  /** Optional flag to enforce diff presence and budget check before tool execution. */
  requiresDiff?: boolean;

  /** Optional flag to enforce file presence and budget check before tool execution. */
  requiresFile?: boolean;

  /** Optional override for schema validation retries. Defaults to GEMINI_SCHEMA_RETRIES env var. */
  schemaRetries?: number;

  /** Optional thinking level. */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';

  /** Optional timeout in ms for the Gemini call. Defaults to 90,000 ms. Use DEFAULT_TIMEOUT_PRO_MS for Pro model calls. */
  timeoutMs?: number;

  /** Optional max output tokens for Gemini. */
  maxOutputTokens?: number;

  /**
   * Optional sampling temperature for this tool's Gemini call.
   * Gemini 3 recommends 1.0 for all tasks.
   */
  temperature?: number;

  /** Optional opt-in to Gemini thought output. Defaults to false. */
  includeThoughts?: boolean;

  /** Optional deterministic JSON mode for stricter key ordering and repair prompting. */
  deterministicJson?: boolean;

  /** Optional batch execution mode. Defaults to runtime setting. */
  batchMode?: 'off' | 'inline';

  /** Optional formatter for human-readable text output. */
  formatOutput?: (result: TFinal) => string;

  /** Optional context text used in progress messages. */
  progressContext?: (input: TInput) => string;

  /** Optional short outcome suffix for the completion progress message (e.g., "3 findings"). */
  formatOutcome?: (result: TFinal) => string;

  /** Optional MCP annotation overrides for this tool. */
  annotations?: ToolAnnotations;

  /** Builds the system instruction and user prompt from parsed tool input. */
  buildPrompt: (input: TInput, ctx: ToolExecutionContext) => PromptParts;

  /**
   * Optional custom generation function. When provided, replaces the standard
   * generateStructuredJson + resultSchema.parse pipeline. Must return a parsed TResult.
   */
  customGenerate?: (
    promptParts: PromptParts,
    ctx: ToolExecutionContext,
    opts: {
      onLog: (level: string, data: unknown) => Promise<void>;
      signal?: AbortSignal;
    }
  ) => Promise<TResult>;
}

function createGeminiResponseSchema(config: {
  geminiSchema: z.ZodType | undefined;
  resultSchema: z.ZodType;
}): Record<string, unknown> {
  const sourceSchema = config.geminiSchema ?? config.resultSchema;
  return stripJsonSchemaConstraints(
    z.toJSONSchema(sourceSchema, {
      target: 'draft-2020-12',
    }) as Record<string, unknown>
  );
}

function getCachedGeminiResponseSchema<
  TInput extends object,
  TResult extends object,
  TFinal extends TResult,
>(
  config: StructuredToolTaskConfig<TInput, TResult, TFinal>
): Record<string, unknown> {
  const cached = responseSchemaCache.get(config);
  if (cached) {
    return cached;
  }

  const responseSchema = createGeminiResponseSchema({
    geminiSchema: config.geminiSchema,
    resultSchema: config.resultSchema,
  });
  responseSchemaCache.set(config, responseSchema);
  return responseSchema;
}

function parseToolInput<TInput extends object>(
  input: unknown,
  fullInputSchema: z.ZodType<TInput>
): TInput {
  return fullInputSchema.parse(input);
}

function extractResponseKeyOrdering(
  responseSchema: Readonly<Record<string, unknown>>
): readonly string[] | undefined {
  const schemaType = responseSchema.type;
  if (schemaType !== 'object') {
    return undefined;
  }

  const { properties } = responseSchema;
  if (typeof properties !== 'object' || properties === null) {
    return undefined;
  }

  return Object.keys(properties as Record<string, unknown>);
}

export function summarizeSchemaValidationErrorForRetry(
  errorMessage: string
): string {
  const maxChars = Math.max(200, schemaRetryErrorCharsConfig.get());
  const compact = errorMessage.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, maxChars - 3)}...`;
}

function createSchemaRetryPrompt(
  prompt: string,
  errorMessage: string,
  deterministicJson: boolean
): { prompt: string; summarizedError: string } {
  const summarizedError = summarizeSchemaValidationErrorForRetry(errorMessage);
  const deterministicNote = deterministicJson
    ? `\n${DETERMINISTIC_JSON_RETRY_NOTE}`
    : '';

  return {
    summarizedError,
    prompt: `CRITICAL: The previous response failed schema validation. Error: ${summarizedError}${deterministicNote}\n\n${prompt}`,
  };
}

function isRetryableSchemaError(error: unknown): boolean {
  const isZodError = error instanceof z.ZodError;
  return isZodError || JSON_PARSE_ERROR_PATTERN.test(getErrorMessage(error));
}

function createGenerationRequest<
  TInput extends object,
  TResult extends object,
  TFinal extends TResult,
>(
  config: StructuredToolTaskConfig<TInput, TResult, TFinal>,
  promptParts: PromptParts,
  responseSchema: Record<string, unknown>,
  onLog: (level: string, data: unknown) => Promise<void>,
  signal?: AbortSignal,
  cachedContent?: string
): GeminiStructuredRequest {
  const request: GeminiStructuredRequest = {
    systemInstruction: promptParts.systemInstruction,
    prompt: promptParts.prompt,
    responseSchema,
    onLog,
    ...(config.thinkingLevel !== undefined
      ? { thinkingLevel: config.thinkingLevel }
      : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.maxOutputTokens !== undefined
      ? { maxOutputTokens: config.maxOutputTokens }
      : {}),
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.includeThoughts !== undefined
      ? { includeThoughts: config.includeThoughts }
      : {}),
    ...(config.batchMode !== undefined ? { batchMode: config.batchMode } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(cachedContent !== undefined ? { cachedContent } : {}),
  };

  if (config.deterministicJson) {
    const responseKeyOrdering = extractResponseKeyOrdering(responseSchema);
    if (responseKeyOrdering !== undefined) {
      request.responseKeyOrdering = responseKeyOrdering;
    }
  }

  return request;
}

function appendStaleDiffWarning(
  textContent: string | undefined,
  diffSlot: DiffSlot | undefined
): string | undefined {
  if (!diffSlot) {
    return textContent;
  }

  const ageMs = Date.now() - diffSlot.generatedAtMs;
  if (ageMs <= diffStaleWarningMs.get()) {
    return textContent;
  }

  const ageMinutes = Math.round(ageMs / 60_000);
  const warning = `${STALE_DIFF_WARNING_PREFIX}${ageMinutes}${STALE_DIFF_WARNING_SUFFIX}`;
  return textContent ? textContent + warning : warning;
}

function toLoggingLevel(level: string): LoggingLevel {
  switch (level) {
    case 'debug':
    case 'info':
    case 'notice':
    case 'warning':
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      return level;
    default:
      return 'error';
  }
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return { payload: value };
}

async function safeSendProgress(
  extra: ProgressExtra,
  toolName: string,
  context: string,
  current: 0 | 1,
  state: 'starting' | 'completed' | 'failed' | 'cancelled'
): Promise<void> {
  try {
    await sendSingleStepProgress(extra, toolName, context, current, state);
  } catch {
    // Progress is best-effort; tool execution must not fail on notification errors.
  }
}

export function wrapToolHandler<TInput, TResult extends CallToolResult>(
  options: {
    toolName: string;
    progressContext?: (input: TInput) => string;
  },
  handler: (input: TInput, extra: ProgressExtra) => Promise<TResult> | TResult
) {
  return async (input: TInput, extra: ProgressExtra): Promise<TResult> => {
    const context = normalizeProgressContext(options.progressContext?.(input));

    await safeSendProgress(extra, options.toolName, context, 0, 'starting');

    try {
      const result = await handler(input, extra);
      const outcome = result.isError ? 'failed' : 'completed';
      await safeSendProgress(extra, options.toolName, context, 1, outcome);
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const failureMeta = classifyErrorMeta(error, errorMessage);
      const outcome = failureMeta.kind === 'cancelled' ? 'cancelled' : 'failed';
      await safeSendProgress(extra, options.toolName, context, 1, outcome);
      throw error;
    }
  };
}

async function validateRequest<
  TInput extends object,
  TResult extends object,
  TFinal extends TResult,
>(
  config: StructuredToolTaskConfig<TInput, TResult, TFinal>,
  inputRecord: TInput,
  ctx: ToolExecutionContext
): Promise<ReturnType<typeof createErrorToolResponse> | undefined> {
  if (config.requiresDiff) {
    if (!ctx.diffSlot) {
      return createNoDiffError();
    }

    const budgetError = validateDiffBudget(ctx.diffSlot.diff);
    if (budgetError) {
      return budgetError;
    }
  }

  if (config.requiresFile) {
    if (!ctx.fileSlot) {
      return createNoFileError();
    }

    const budgetError = validateFileBudget(ctx.fileSlot.content);
    if (budgetError) {
      return budgetError;
    }
  }

  if (config.validateInput) {
    return await config.validateInput(inputRecord, ctx);
  }

  return undefined;
}

export class ToolExecutionRunner<
  TInput extends object,
  TResult extends object,
  TFinal extends TResult,
> {
  private diffSlotSnapshot: DiffSlot | undefined;
  private hasSnapshot = false;
  private responseSchema: Record<string, unknown>;
  private readonly onLog: (level: string, data: unknown) => Promise<void>;
  private reporter: RunReporter;
  private executionCtx: ToolExecutionContext | undefined;

  constructor(
    private readonly config: StructuredToolTaskConfig<TInput, TResult, TFinal>,
    dependencies: {
      onLog: (level: string, data: unknown) => Promise<void>;
      reportProgress: (payload: ProgressPayload) => Promise<void>;
      statusReporter: TaskStatusReporter;
    },
    private readonly signal?: AbortSignal
  ) {
    this.responseSchema = getCachedGeminiResponseSchema(config);
    // Initialize reporter with placeholder context; updated in run()
    this.reporter = new RunReporter(
      config.title,
      dependencies.reportProgress,
      dependencies.statusReporter,
      DEFAULT_PROGRESS_CONTEXT
    );

    this.onLog = async (level: string, data: unknown): Promise<void> => {
      try {
        await dependencies.onLog(level, data);
      } catch {
        // Ignore logging failures
      }
      await this.handleInternalLog(data);
    };
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException('Task cancelled', 'AbortError');
    }
  }

  private async handleInternalLog(data: unknown): Promise<void> {
    const record = asObjectRecord(data);
    if (record.event === 'gemini_retry') {
      const details = asObjectRecord(record.details);
      const { attempt } = details;
      const msg = `retrying (attempt ${String(attempt)})`;

      await this.reporter.reportStep(STEP_CALLING_MODEL, msg);
    } else if (record.event === 'gemini_queue_acquired') {
      const msg = 'waiting for model';
      await this.reporter.reportStep(STEP_CALLING_MODEL, msg);
    }
  }

  setResponseSchemaOverride(responseSchema: Record<string, unknown>): void {
    this.responseSchema = responseSchema;
    responseSchemaCache.set(this.config, responseSchema);
  }

  setDiffSlotSnapshot(diffSlotSnapshot: DiffSlot | undefined): void {
    this.diffSlotSnapshot = diffSlotSnapshot;
    this.hasSnapshot = true;
  }

  private async executeValidation(
    inputRecord: TInput,
    ctx: ToolExecutionContext
  ): Promise<ReturnType<typeof createErrorToolResponse> | undefined> {
    const validationError = await validateRequest(
      this.config,
      inputRecord,
      ctx
    );

    if (validationError) {
      const validationMessage = extractValidationMessage(validationError);
      await this.reporter.updateStatus(validationMessage);
      await this.reporter.reportCompletion('validation failed');
      await this.reporter.storeResultSafely(
        'failed',
        validationError,
        this.onLog
      );
      return validationError;
    }
    return undefined;
  }

  private async executeModelCallAttempt(
    systemInstruction: string,
    prompt: string,
    attempt: number
  ): Promise<TResult> {
    // Use snapshotted cache name from context instead of reading global state.
    const cachedContent = this.executionCtx?.diffCacheSlotName;

    const raw = await generateStructuredJson(
      createGenerationRequest(
        this.config,
        { systemInstruction, prompt },
        this.responseSchema,
        this.onLog,
        this.signal,
        cachedContent
      )
    );

    if (attempt === 0) {
      await this.reporter.reportStep(
        STEP_VALIDATING_RESPONSE,
        'parsing response'
      );
    }

    const parseSchema = this.config.geminiSchema ?? this.config.resultSchema;
    return parseSchema.parse(raw);
  }

  private async executeModelCall(
    systemInstruction: string,
    prompt: string
  ): Promise<TResult> {
    let retryPrompt = prompt;
    const maxRetries =
      this.config.schemaRetries ?? geminiSchemaRetriesConfig.get();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.executeModelCallAttempt(
          systemInstruction,
          retryPrompt,
          attempt
        );
      } catch (error: unknown) {
        if (attempt >= maxRetries || !isRetryableSchemaError(error)) {
          throw error;
        }

        const errorMessage = getErrorMessage(error);
        const schemaRetryPrompt = createSchemaRetryPrompt(
          prompt,
          errorMessage,
          this.config.deterministicJson === true
        );
        await this.onLog('warning', {
          event: 'schema_validation_failed',
          details: {
            attempt,
            error: schemaRetryPrompt.summarizedError,
            originalChars: errorMessage.length,
          },
        });

        await this.reporter.reportSchemaRetry(attempt + 1, maxRetries);

        retryPrompt = schemaRetryPrompt.prompt;
      }
    }

    throw new Error('Unexpected state: execution loop exhausted');
  }

  private createExecutionContext(): ToolExecutionContext {
    const diffSlot = this.hasSnapshot ? this.diffSlotSnapshot : getDiff();
    return {
      diffSlot,
      fileSlot: getFile(),
      diffCacheSlotName: this.config.requiresDiff
        ? getDiffCacheSlot()?.cacheName
        : undefined,
    };
  }

  private applyResultTransform(
    inputRecord: TInput,
    parsed: TResult,
    ctx: ToolExecutionContext
  ): TFinal {
    return (
      this.config.transformResult
        ? this.config.transformResult(inputRecord, parsed, ctx)
        : parsed
    ) as TFinal;
  }

  private formatResultText(
    finalResult: TFinal,
    ctx: ToolExecutionContext
  ): string | undefined {
    const textContent = this.config.formatOutput
      ? this.config.formatOutput(finalResult)
      : undefined;
    return appendStaleDiffWarning(textContent, ctx.diffSlot);
  }

  private async finalizeSuccessfulRun(
    finalResult: TFinal,
    textContent: string | undefined
  ): Promise<CallToolResult> {
    const outcome = this.config.formatOutcome?.(finalResult) ?? 'completed';
    await this.reporter.reportCompletion(outcome);
    await this.reporter.updateStatus(`${COMPLETED_STATUS_PREFIX}${outcome}`);

    const successResponse = createToolResponse(
      {
        ok: true as const,
        result: finalResult,
      },
      textContent
    );
    await this.reporter.storeResultSafely(
      'completed',
      successResponse,
      this.onLog
    );
    return successResponse;
  }

  private async handleRunFailure(error: unknown): Promise<CallToolResult> {
    const errorMessage = getErrorMessage(error);
    const errorMeta = classifyErrorMeta(error, errorMessage);
    const outcome = errorMeta.kind === 'cancelled' ? 'cancelled' : 'failed';
    await this.reporter.updateStatus(
      createFailureStatusMessage(outcome, errorMessage)
    );

    const errorResponse = createErrorToolResponse(
      this.config.errorCode,
      errorMessage,
      undefined,
      errorMeta
    );

    if (outcome === 'cancelled') {
      await this.reporter.reportCancellation(errorMessage);
    } else {
      await this.reporter.storeResultSafely(
        'failed',
        errorResponse,
        this.onLog
      );
    }
    await this.reporter.reportCompletion(outcome);
    return errorResponse;
  }

  async run(input: unknown): Promise<CallToolResult> {
    try {
      await this.reporter.reportStep(STEP_STARTING, 'starting');

      const inputRecord = parseToolInput<TInput>(
        input,
        this.config.fullInputSchema
      );

      const newContext = normalizeProgressContext(
        this.config.progressContext?.(inputRecord)
      );
      this.reporter.updateContext(newContext);

      const ctx = this.createExecutionContext();
      this.executionCtx = ctx;

      this.throwIfAborted();
      await this.reporter.reportStep(STEP_VALIDATING, 'validating input');

      const validationError = await this.executeValidation(inputRecord, ctx);
      if (validationError) {
        return validationError;
      }

      this.throwIfAborted();
      await this.reporter.reportStep(STEP_BUILDING_PROMPT, 'preparing prompt');

      const promptParts = this.config.buildPrompt(inputRecord, ctx);
      const { prompt, systemInstruction } = promptParts;

      this.throwIfAborted();
      await this.reporter.reportStep(STEP_CALLING_MODEL, 'analyzing');

      let parsed: TResult;
      if (this.config.customGenerate) {
        parsed = await this.config.customGenerate(promptParts, ctx, {
          onLog: this.onLog,
          ...(this.signal ? { signal: this.signal } : {}),
        });
      } else {
        parsed = await this.executeModelCall(systemInstruction, prompt);
      }

      this.throwIfAborted();
      await this.reporter.reportStep(STEP_FINALIZING, 'finalizing');

      const finalResult = this.applyResultTransform(inputRecord, parsed, ctx);
      this.throwIfAborted();
      this.config.resultSchema.parse(finalResult);
      const textContent = this.formatResultText(finalResult, ctx);
      return await this.finalizeSuccessfulRun(finalResult, textContent);
    } catch (error: unknown) {
      return await this.handleRunFailure(error);
    }
  }
}

interface ExtendedRequestTaskStore extends RequestTaskStore {
  updateTaskStatus(
    taskId: string,
    status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled',
    statusMessage?: string
  ): Promise<void>;
}

/** Runtime check: SDK's InMemoryTaskStore exposes updateTaskStatus. */
function hasTaskStatusUpdate(
  store: RequestTaskStore
): store is RequestTaskStore &
  Pick<ExtendedRequestTaskStore, 'updateTaskStatus'> {
  return 'updateTaskStatus' in store;
}

// Utility function to read a file as UTF-8 text with consistent error handling.
function toProgressExtra(extra: CreateTaskRequestHandlerExtra): ProgressExtra {
  return extra as unknown as ProgressExtra;
}

export function createGeminiLogger(
  server: McpServer
): (level: string, data: unknown) => Promise<void> {
  return async (level, data) => {
    try {
      await server.sendLoggingMessage({
        level: toLoggingLevel(level),
        logger: 'gemini',
        data: asObjectRecord(data),
      });
    } catch {
      // Fallback if logging fails
    }
  };
}

function createTaskStatusReporter(
  taskId: string,
  extra: CreateTaskRequestHandlerExtra,
  store: RequestTaskStore
): TaskStatusReporter {
  return {
    updateStatus: async (message) => {
      if (hasTaskStatusUpdate(store)) {
        await store.updateTaskStatus(taskId, 'working', message);
      }
    },
    storeResult: async (status, result) => {
      await extra.taskStore.storeTaskResult(taskId, status, result);
    },
    reportCancellation: async (message) => {
      if (hasTaskStatusUpdate(store)) {
        await store.updateTaskStatus(taskId, 'cancelled', message);
      }
    },
  };
}

function runToolTaskInBackground<
  TInput extends object,
  TResult extends object,
  TFinal extends TResult,
>(
  runner: ToolExecutionRunner<TInput, TResult, TFinal>,
  input: unknown,
  taskId: string,
  store: RequestTaskStore,
  signal?: AbortSignal
): void {
  if (signal?.aborted) {
    if (hasTaskStatusUpdate(store)) {
      store
        .updateTaskStatus(
          taskId,
          'cancelled',
          'Cancelled before execution started'
        )
        .catch(() => {});
    }
    return;
  }

  runner.run(input).catch(async (error: unknown) => {
    // Safety net: run() swallows errors via handleRunFailure, so this only fires
    // if handleRunFailure itself throws (e.g. reporter/store internal crash).
    const isAbort =
      error != null &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: string }).name === 'AbortError';
    const isCancelled = (signal?.aborted ?? false) || isAbort;

    try {
      if (hasTaskStatusUpdate(store)) {
        await store.updateTaskStatus(
          taskId,
          isCancelled ? 'cancelled' : 'failed',
          getErrorMessage(error)
        );
      }
    } catch {
      // Status update failed — nothing more we can do
    }
  });
}

export function registerStructuredToolTask<
  TInput extends object,
  TResult extends object = Record<string, unknown>,
  TFinal extends TResult = TResult,
>(
  server: McpServer,
  config: StructuredToolTaskConfig<TInput, TResult, TFinal>
): void {
  const responseSchema = config.customGenerate
    ? {}
    : createGeminiResponseSchema({
        geminiSchema: config.geminiSchema,
        resultSchema: config.resultSchema,
      });
  responseSchemaCache.set(config, responseSchema);

  const outputSchema = createToolOutputSchema(config.resultSchema);

  server.experimental.tasks.registerToolTask(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema,
      annotations: buildToolAnnotations(config.annotations),
      execution: {
        taskSupport: 'optional',
      },
    },
    {
      createTask: async (
        input: unknown,
        extra: CreateTaskRequestHandlerExtra
      ) => {
        const task = await extra.taskStore.createTask({
          ttl: taskTtlMsConfig.get(),
        });

        const runner = new ToolExecutionRunner(
          config,
          {
            onLog: createGeminiLogger(server),
            reportProgress: getOrCreateProgressReporter(toProgressExtra(extra)),
            statusReporter: createTaskStatusReporter(
              task.taskId,
              extra,
              extra.taskStore
            ),
          },
          extra.signal
        );

        runToolTaskInBackground(
          runner,
          input,
          task.taskId,
          extra.taskStore,
          extra.signal
        );

        return {
          task,
          _meta: {
            'io.modelcontextprotocol/model-immediate-response': `${config.title} is running in the background.`,
          },
        };
      },
      getTask: async (input: unknown, extra: TaskRequestHandlerExtra) => {
        return await extra.taskStore.getTask(extra.taskId);
      },
      getTaskResult: async (input: unknown, extra: TaskRequestHandlerExtra) => {
        return (await extra.taskStore.getTaskResult(
          extra.taskId
        )) as CallToolResult;
      },
    }
  );
}

const EMPTY_PARSED_FILES: readonly ParsedFile[] = [];

export interface DiffContextSnapshot {
  diff: string;
  parsedFiles: readonly ParsedFile[];
  stats: Readonly<DiffStats>;
}

export function getDiffContextSnapshot(
  ctx: ToolExecutionContext
): DiffContextSnapshot {
  const slot = ctx.diffSlot;
  if (!slot) {
    return {
      diff: '',
      parsedFiles: EMPTY_PARSED_FILES,
      stats: EMPTY_DIFF_STATS,
    };
  }

  return {
    diff: slot.diff,
    parsedFiles: slot.parsedFiles,
    stats: slot.stats,
  };
}

export interface FileContextSnapshot {
  filePath: string;
  content: string;
  language: string;
  lineCount: number;
  sizeChars: number;
}

const EMPTY_FILE_SNAPSHOT: FileContextSnapshot = {
  filePath: '',
  content: '',
  language: '',
  lineCount: 0,
  sizeChars: 0,
};

export function getFileContextSnapshot(
  ctx: ToolExecutionContext
): FileContextSnapshot {
  const slot = ctx.fileSlot;
  if (!slot) {
    return EMPTY_FILE_SNAPSHOT;
  }

  return {
    filePath: slot.filePath,
    content: slot.content,
    language: slot.language,
    lineCount: slot.lineCount,
    sizeChars: slot.sizeChars,
  };
}
