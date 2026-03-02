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

import { DefaultOutputSchema } from '../schemas/outputs.js';

import {
  ANALYSIS_TEMPERATURE,
  CREATIVE_TEMPERATURE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_EXTENDED_MS,
  FLASH_MODEL,
  FLASH_THINKING_LEVEL,
  FLASH_TRIAGE_THINKING_LEVEL,
  TRIAGE_TEMPERATURE,
} from './config.js';
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

export type ErrorKind =
  | 'validation'
  | 'budget'
  | 'upstream'
  | 'timeout'
  | 'cancelled'
  | 'internal'
  | 'busy';

export interface ErrorMeta {
  retryable?: boolean;
  kind?: ErrorKind;
}

interface ToolError {
  code: string;
  message: string;
  retryable?: boolean;
  kind?: ErrorKind;
}

interface ToolTextContent {
  type: 'text';
  text: string;
}

interface ToolStructuredContent {
  [key: string]: unknown;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
}

interface ToolResponse<TStructuredContent extends ToolStructuredContent> {
  [key: string]: unknown;
  content: ToolTextContent[];
  structuredContent: TStructuredContent;
}

interface ErrorToolResponse {
  [key: string]: unknown;
  content: ToolTextContent[];
  isError: true;
}

function appendErrorMeta(error: ToolError, meta?: ErrorMeta): void {
  if (meta?.retryable !== undefined) {
    error.retryable = meta.retryable;
  }
  if (meta?.kind !== undefined) {
    error.kind = meta.kind;
  }
}

function createToolError(
  code: string,
  message: string,
  meta?: ErrorMeta
): ToolError {
  const error: ToolError = { code, message };
  appendErrorMeta(error, meta);
  return error;
}

function toTextContent(
  structured: ToolStructuredContent,
  textContent?: string
): ToolTextContent[] {
  const text = textContent ?? JSON.stringify(structured);
  return [{ type: 'text', text }];
}

function createErrorStructuredContent(
  code: string,
  message: string,
  result?: unknown,
  meta?: ErrorMeta
): ToolStructuredContent {
  const error = createToolError(code, message, meta);

  if (result === undefined) {
    return { ok: false, error };
  }

  return { ok: false, error, result };
}

export function createToolResponse<
  TStructuredContent extends ToolStructuredContent,
>(
  structured: TStructuredContent,
  textContent?: string
): ToolResponse<TStructuredContent> {
  return {
    content: toTextContent(structured, textContent),
    structuredContent: structured,
  };
}

export function createErrorToolResponse(
  code: string,
  message: string,
  result?: unknown,
  meta?: ErrorMeta
): ErrorToolResponse {
  const structured = createErrorStructuredContent(code, message, result, meta);
  return {
    content: toTextContent(structured),
    isError: true,
  };
}

const DEFAULT_TIMEOUT_FLASH_MS = 90_000;

export const INSPECTION_FOCUS_AREAS = [
  'security',
  'correctness',
  'performance',
  'regressions',
  'tests',
  'maintainability',
  'concurrency',
] as const;

export interface ToolParameterContract {
  name: string;
  type: string;
  required: boolean;
  constraints: string;
  description: string;
}

export interface ToolContract {
  name: string;
  purpose: string;
  /** Set to 'none' for synchronous (non-Gemini) tools. */
  model: string;
  /** Set to 0 for synchronous (non-Gemini) tools. */
  timeoutMs: number;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  /** Set to 0 for synchronous (non-Gemini) tools. */
  maxOutputTokens: number;
  /**
   * Sampling temperature for the Gemini call.
   * Gemini 3 recommends 1.0 for all tasks.
   */
  temperature?: number;
  /** Enables deterministic JSON guidance and schema key ordering. */
  deterministicJson?: boolean;
  params: readonly ToolParameterContract[];
  outputShape: string;
  gotchas: readonly string[];
  crossToolFlow: readonly string[];
  constraints?: readonly string[];
}

interface StructuredToolRuntimeOptions {
  thinkingLevel?: NonNullable<ToolContract['thinkingLevel']>;
  temperature?: NonNullable<ToolContract['temperature']>;
  deterministicJson?: NonNullable<ToolContract['deterministicJson']>;
}

interface StructuredToolExecutionOptions extends StructuredToolRuntimeOptions {
  timeoutMs: ToolContract['timeoutMs'];
  maxOutputTokens: ToolContract['maxOutputTokens'];
}

export function buildStructuredToolRuntimeOptions(
  contract: Pick<
    ToolContract,
    'thinkingLevel' | 'temperature' | 'deterministicJson'
  >
): StructuredToolRuntimeOptions {
  return {
    ...(contract.thinkingLevel !== undefined
      ? { thinkingLevel: contract.thinkingLevel }
      : {}),
    ...(contract.temperature !== undefined
      ? { temperature: contract.temperature }
      : {}),
    ...(contract.deterministicJson !== undefined
      ? { deterministicJson: contract.deterministicJson }
      : {}),
  };
}

export function buildStructuredToolExecutionOptions(
  contract: Pick<
    ToolContract,
    | 'timeoutMs'
    | 'maxOutputTokens'
    | 'thinkingLevel'
    | 'temperature'
    | 'deterministicJson'
  >
): StructuredToolExecutionOptions {
  return {
    timeoutMs: contract.timeoutMs,
    maxOutputTokens: contract.maxOutputTokens,
    ...buildStructuredToolRuntimeOptions(contract),
  };
}

function createParam(
  name: string,
  type: string,
  required: boolean,
  constraints: string,
  description: string
): ToolParameterContract {
  return { name, type, required, constraints, description };
}

function cloneParams(
  ...params: readonly ToolParameterContract[]
): ToolParameterContract[] {
  return params.map((param) => ({ ...param }));
}

const MODE_PARAM = createParam(
  'mode',
  'string',
  true,
  "'unstaged' | 'staged'",
  "'unstaged': working tree changes not yet staged. 'staged': changes added to the index (git add)."
);

const REPOSITORY_PARAM = createParam(
  'repository',
  'string',
  true,
  '1-200 chars',
  'Repository identifier (org/repo).'
);

const LANGUAGE_PARAM = createParam(
  'language',
  'string',
  false,
  '2-32 chars',
  'Primary language hint.'
);

const TEST_FRAMEWORK_PARAM = createParam(
  'testFramework',
  'string',
  false,
  '1-50 chars',
  'Framework hint (jest, vitest, pytest, node:test).'
);

const MAX_TEST_CASES_PARAM = createParam(
  'maxTestCases',
  'number',
  false,
  '1-30',
  'Post-generation cap applied to test cases.'
);

const FILE_PATH_PARAM = createParam(
  'filePath',
  'string',
  true,
  '1-500 chars',
  'Absolute path to the file to analyze.'
);

const QUESTION_PARAM = createParam(
  'question',
  'string',
  true,
  '1-2000 chars',
  'Question about the loaded file.'
);

export const TOOL_CONTRACTS = [
  {
    name: 'generate_diff',
    purpose:
      'Generate a diff of current changes and cache it server-side. MUST be called before any other tool. Uses git to capture unstaged or staged changes in the current working directory.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(MODE_PARAM),
    outputShape:
      '{ok, result: {diffRef, stats{files, added, deleted}, generatedAt, mode, message}}',
    gotchas: [
      'Must be called first — all other tools return E_NO_DIFF if no diff is cached.',
      'Noisy files (lock files, dist/, build/, minified assets) are excluded automatically.',
      'Empty diff (no changes) returns E_NO_CHANGES.',
    ],
    crossToolFlow: [
      'Caches diff at internal://diff/current — consumed automatically by all review tools.',
    ],
  },
  {
    name: 'analyze_pr_impact',
    purpose:
      'Assess severity, categories, breaking changes, and rollback complexity.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(REPOSITORY_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{severity, categories[], summary, breakingChanges[], affectedAreas[], rollbackComplexity}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Flash triage tool optimized for speed.',
    ],
    crossToolFlow: [
      'severity/categories feed triage and merge-gate decisions.',
    ],
  },
  {
    name: 'generate_review_summary',
    purpose: 'Produce PR summary, risk rating, and merge recommendation.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(REPOSITORY_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{summary, overallRisk, keyChanges[], recommendation, stats{filesChanged, linesAdded, linesRemoved}}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'stats are computed locally from the diff.',
    ],
    crossToolFlow: [
      'Use before deep review to decide whether Pro analysis is needed.',
    ],
  },
  {
    name: 'generate_test_plan',
    purpose: 'Generate prioritized test cases and coverage guidance.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: CREATIVE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(
      REPOSITORY_PARAM,
      LANGUAGE_PARAM,
      TEST_FRAMEWORK_PARAM,
      MAX_TEST_CASES_PARAM
    ),
    outputShape: '{summary, testCases[], coverageSummary}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'maxTestCases caps output after generation.',
    ],
    crossToolFlow: ['Pair with review tools to validate high-risk paths.'],
  },
  {
    name: 'analyze_time_space_complexity',
    purpose:
      'Analyze Big-O complexity and detect degradations in changed code.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{timeComplexity, spaceComplexity, explanation, potentialBottlenecks[], isDegradation}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Analyzes only changed code visible in the diff.',
    ],
    crossToolFlow: ['Use for algorithmic/performance-sensitive changes.'],
  },
  {
    name: 'detect_api_breaking_changes',
    purpose: 'Detect breaking API/interface changes in a diff.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    thinkingLevel: FLASH_TRIAGE_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: TRIAGE_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape: '{hasBreakingChanges, breakingChanges[]}',
    gotchas: [
      'Requires generate_diff to be called first.',
      'Targets public API contracts over internal refactors.',
    ],
    crossToolFlow: ['Run before merge for API-surface-sensitive changes.'],
  },
  {
    name: 'load_file',
    purpose:
      'Read a single file from disk and cache it server-side. MUST be called before any file analysis tool.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(FILE_PATH_PARAM),
    outputShape:
      '{ok, result: {fileRef, filePath, language, lineCount, sizeChars, cachedAt, message}}',
    gotchas: [
      'Single file only — overwrites previous cache.',
      'Max file size enforced (120K chars default).',
      'File must be under workspace root.',
    ],
    crossToolFlow: [
      'Caches file at internal://file/current — consumed by refactor_code and future analysis tools.',
    ],
  },
  {
    name: 'refactor_code',
    purpose:
      'Analyze cached file for naming, complexity, duplication, and grouping improvements.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(LANGUAGE_PARAM),
    outputShape:
      '{filePath, language, summary, suggestions[{category, target, currentIssue, suggestion, priority}], *IssuesCount}',
    gotchas: [
      'Requires load_file first.',
      'Analyzes one file — does not suggest cross-file moves.',
    ],
    crossToolFlow: [
      'Use after load_file. Provides refactoring roadmap for the cached file.',
    ],
  },
  {
    name: 'ask_about_code',
    purpose: 'Answer natural-language questions about a cached file.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(QUESTION_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{answer, codeReferences[{target, explanation}], confidence, filePath, language}',
    gotchas: [
      'Requires load_file first.',
      'Answers based solely on the cached file content.',
    ],
    crossToolFlow: [
      'Use after load_file. Complements refactor_code for understanding code.',
    ],
  },
  {
    name: 'verify_logic',
    purpose:
      'Verify algorithms and logic in cached file using Gemini code execution sandbox.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: false,
    params: cloneParams(QUESTION_PARAM, LANGUAGE_PARAM),
    outputShape:
      '{answer, verified, codeBlocks[{code, language}], executionResults[{outcome, output}], filePath, language}',
    gotchas: [
      'Requires load_file first.',
      'Code execution runs Python only (server-side sandbox).',
    ],
    crossToolFlow: [
      'Use after load_file. Complements ask_about_code for verification tasks.',
    ],
  },
  {
    name: 'web_search',
    purpose:
      'Perform a Google Search with Grounding to get up-to-date information.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_FLASH_MS,
    maxOutputTokens: 0,
    params: cloneParams(QUESTION_PARAM),
    outputShape: '{ok, result: {text, groundingMetadata}}',
    gotchas: [
      'Uses Gemini grounding — results depend on Google Search availability.',
      'No diff or file prerequisite.',
    ],
    crossToolFlow: [
      'Standalone tool for fetching up-to-date information from the web.',
    ],
  },
  {
    name: 'index_repository',
    purpose:
      'Walk a local repository, upload source files to a Gemini File Search Store for RAG queries.',
    model: 'none',
    timeoutMs: 0,
    maxOutputTokens: 0,
    params: cloneParams(FILE_PATH_PARAM),
    outputShape:
      '{ok, result: {storeName, displayName, filesUploaded, filesSkipped, message}}',
    gotchas: [
      'Must be called before query_repository.',
      'Max 500 files, 1 MB per file.',
      'Re-indexing replaces the previous store.',
    ],
    crossToolFlow: ['Creates a search store consumed by query_repository.'],
  },
  {
    name: 'query_repository',
    purpose:
      'Query the indexed repository search store using natural language.',
    model: FLASH_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_EXTENDED_MS,
    thinkingLevel: FLASH_THINKING_LEVEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: ANALYSIS_TEMPERATURE,
    deterministicJson: true,
    params: cloneParams(QUESTION_PARAM),
    outputShape: '{ok, result: {answer, references[]}}',
    gotchas: [
      'Requires index_repository first.',
      'Quality depends on indexed file coverage.',
    ],
    crossToolFlow: [
      'Use after index_repository for targeted codebase questions.',
    ],
  },
] as const satisfies readonly ToolContract[];

const TOOL_CONTRACTS_BY_NAME = new Map<string, ToolContract>(
  TOOL_CONTRACTS.map((contract) => [contract.name, contract])
);

export function getToolContracts(): readonly ToolContract[] {
  return TOOL_CONTRACTS;
}

export function getToolContract(toolName: string): ToolContract | undefined {
  return TOOL_CONTRACTS_BY_NAME.get(toolName);
}

export function requireToolContract(toolName: string): ToolContract {
  const contract = getToolContract(toolName);
  if (contract) {
    return contract;
  }

  throw new Error(`Unknown tool contract: ${toolName}`);
}

export function getToolContractNames(): string[] {
  return TOOL_CONTRACTS.map((contract) => contract.name);
}

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
      openWorldHint: true,
    };
  }

  const { destructiveHint, ...annotationOverrides } = annotations;

  return {
    readOnlyHint: !destructiveHint,
    idempotentHint: !destructiveHint,
    openWorldHint: true,
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

  /** Zod schema for parsing and validating the Gemini structured response. */
  resultSchema: z.ZodType<TResult>;

  /** Optional Zod schema used specifically for Gemini response validation. */
  geminiSchema?: z.ZodType;

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

  const ageMs = Date.now() - new Date(diffSlot.generatedAt).getTime();
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
      config.name,
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

  private async handleInternalLog(data: unknown): Promise<void> {
    const record = asObjectRecord(data);
    if (record.event === 'gemini_retry') {
      const details = asObjectRecord(record.details);
      const { attempt } = details;
      const msg = `Network error. Retrying (attempt ${String(attempt)})...`;

      await this.reporter.reportStep(STEP_CALLING_MODEL, msg);
    } else if (record.event === 'gemini_queue_acquired') {
      const msg = 'Model queue acquired, generating response...';
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
      await this.reporter.reportCompletion('rejected');
      await this.reporter.storeResultSafely(
        'completed',
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
    // Resolve Gemini context cache for diff-dependent tools (best-effort).
    const cachedContent = this.config.requiresDiff
      ? getDiffCacheSlot()?.cacheName
      : undefined;

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
        'Verifying output structure...'
      );
    }

    return this.config.resultSchema.parse(raw);
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
    return {
      diffSlot: this.hasSnapshot ? this.diffSlotSnapshot : getDiff(),
      fileSlot: getFile(),
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

    await this.reporter.storeResultSafely('failed', errorResponse, this.onLog);
    await this.reporter.reportCompletion(outcome);
    return errorResponse;
  }

  async run(input: unknown): Promise<CallToolResult> {
    try {
      await this.reporter.reportStep(STEP_STARTING, 'Initializing...');

      const inputRecord = parseToolInput<TInput>(
        input,
        this.config.fullInputSchema
      );

      const newContext = normalizeProgressContext(
        this.config.progressContext?.(inputRecord)
      );
      this.reporter.updateContext(newContext);

      const ctx = this.createExecutionContext();

      await this.reporter.reportStep(
        STEP_VALIDATING,
        'Validating request parameters...'
      );

      const validationError = await this.executeValidation(inputRecord, ctx);
      if (validationError) {
        return validationError;
      }

      await this.reporter.reportStep(
        STEP_BUILDING_PROMPT,
        'Constructing analysis context...'
      );

      const promptParts = this.config.buildPrompt(inputRecord, ctx);
      const { prompt, systemInstruction } = promptParts;

      await this.reporter.reportStep(
        STEP_CALLING_MODEL,
        'Querying Gemini model...'
      );

      const parsed = await this.executeModelCall(systemInstruction, prompt);

      await this.reporter.reportStep(STEP_FINALIZING, 'Processing results...');

      const finalResult = this.applyResultTransform(inputRecord, parsed, ctx);
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

function createGeminiLogger(
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
  extendedStore: ExtendedRequestTaskStore
): TaskStatusReporter {
  return {
    updateStatus: async (message) => {
      await extendedStore.updateTaskStatus(taskId, 'working', message);
    },
    storeResult: async (status, result) => {
      await extra.taskStore.storeTaskResult(taskId, status, result);
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
  extendedStore: ExtendedRequestTaskStore,
  signal?: AbortSignal
): void {
  runner.run(input).catch(async (error: unknown) => {
    const isAbort =
      error != null &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: string }).name === 'AbortError';
    const isCancelled = (signal?.aborted ?? false) || isAbort;

    try {
      await extendedStore.updateTaskStatus(
        taskId,
        isCancelled ? 'cancelled' : 'failed',
        getErrorMessage(error)
      );
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
  const responseSchema = createGeminiResponseSchema({
    geminiSchema: config.geminiSchema,
    resultSchema: config.resultSchema,
  });
  responseSchemaCache.set(config, responseSchema);

  server.experimental.tasks.registerToolTask(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: DefaultOutputSchema,
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
        const extendedStore =
          extra.taskStore as unknown as ExtendedRequestTaskStore;

        const runner = new ToolExecutionRunner(
          config,
          {
            onLog: createGeminiLogger(server),
            reportProgress: getOrCreateProgressReporter(
              extra as unknown as ProgressExtra
            ),
            statusReporter: createTaskStatusReporter(
              task.taskId,
              extra,
              extendedStore
            ),
          },
          extra.signal
        );

        runToolTaskInBackground(
          runner,
          input,
          task.taskId,
          extendedStore,
          extra.signal
        );

        return { task };
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
