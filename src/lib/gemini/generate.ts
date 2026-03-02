import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import { FinishReason, type GoogleGenAI } from '@google/genai';
import type { GenerateContentConfig } from '@google/genai';

import { ConcurrencyLimiter } from '../concurrency.js';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../config.js';
import { getErrorMessage, toRecord } from '../errors.js';
import { formatUsNumber } from '../format.js';
import {
  emitGeminiLog,
  geminiContext,
  getClient,
  nextRequestId,
  safeCallOnLog,
} from './client.js';
import {
  batchPollIntervalMsConfig,
  batchTimeoutMsConfig,
  CANCELLED_REQUEST_MESSAGE,
  concurrencyWaitMsConfig,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOP_K,
  DEFAULT_TOP_P,
  getDefaultBatchMode,
  getDefaultIncludeThoughts,
  getDefaultModel,
  getSafetySettings,
  getSafetyThreshold,
  getThinkingConfig,
  maxConcurrentBatchCallsConfig,
  maxConcurrentCallsConfig,
} from './config.js';
import {
  canRetryAttempt,
  getRetryDelayMs,
  toUpperStringCode,
} from './retry.js';
import type {
  CodeExecutionBlock,
  CodeExecutionResponse,
  CodeExecutionResultBlock,
  GeminiOnLog,
  GeminiStructuredRequest,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLEEP_UNREF_OPTIONS = { ref: false } as const;
const JSON_CODE_BLOCK_PATTERN = /```(?:json)?\n?([\s\S]*?)(?=\n?```)/u;
const MAX_BATCH_POLL_RETRIES = 2;

type GenerateContentResponse = Awaited<
  ReturnType<GoogleGenAI['models']['generateContent']>
>;

// ---------------------------------------------------------------------------
// Concurrency limiters
// ---------------------------------------------------------------------------

function formatConcurrencyLimitErrorMessage(
  limit: number,
  waitLimitMs: number
): string {
  return `Too many concurrent Gemini calls (limit: ${formatUsNumber(limit)}; waited ${formatUsNumber(waitLimitMs)}ms).`;
}

const callLimiter = new ConcurrencyLimiter(
  () => maxConcurrentCallsConfig.get(),
  () => concurrencyWaitMsConfig.get(),
  (limit, ms) => formatConcurrencyLimitErrorMessage(limit, ms),
  () => CANCELLED_REQUEST_MESSAGE
);

const batchCallLimiter = new ConcurrencyLimiter(
  () => maxConcurrentBatchCallsConfig.get(),
  () => concurrencyWaitMsConfig.get(),
  (limit, ms) => formatConcurrencyLimitErrorMessage(limit, ms),
  () => CANCELLED_REQUEST_MESSAGE
);

// ---------------------------------------------------------------------------
// Generation config helpers
// ---------------------------------------------------------------------------

function applyResponseKeyOrdering(
  responseSchema: Readonly<Record<string, unknown>>,
  responseKeyOrdering: readonly string[] | undefined
): Readonly<Record<string, unknown>> {
  if (!responseKeyOrdering || responseKeyOrdering.length === 0) {
    return responseSchema;
  }

  return {
    ...responseSchema,
    propertyOrdering: [...responseKeyOrdering],
  };
}

function getPromptWithFunctionCallingContext(
  request: GeminiStructuredRequest
): string {
  return request.prompt;
}

function buildGenerationConfig(
  request: GeminiStructuredRequest,
  abortSignal?: AbortSignal
): GenerateContentConfig {
  const includeThoughts =
    request.includeThoughts ?? getDefaultIncludeThoughts();
  const thinkingConfig = getThinkingConfig(
    request.thinkingLevel,
    includeThoughts
  );
  const config: GenerateContentConfig = {
    temperature: request.temperature ?? 1.0,
    topK: request.topK ?? DEFAULT_TOP_K,
    topP: request.topP ?? DEFAULT_TOP_P,
    maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    safetySettings: getSafetySettings(getSafetyThreshold()),
    ...(abortSignal ? { abortSignal } : {}),
  };

  const tools: GenerateContentConfig['tools'] = [];
  if (request.useGrounding) {
    tools.push({ googleSearch: {} });
  }
  if (request.useCodeExecution) {
    tools.push({ codeExecution: {} });
  }
  if (request.fileSearchStoreNames && request.fileSearchStoreNames.length > 0) {
    tools.push({
      fileSearch: {
        fileSearchStoreNames: [...request.fileSearchStoreNames],
      },
    });
  }

  if (tools.length > 0) {
    config.tools = tools;
  } else {
    config.responseMimeType = 'application/json';
    config.responseSchema = applyResponseKeyOrdering(
      request.responseSchema,
      request.responseKeyOrdering
    );
  }

  if (request.systemInstruction) {
    config.systemInstruction = request.systemInstruction;
  }

  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  if (request.cachedContent) {
    config.cachedContent = request.cachedContent;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Signal / sleep helpers
// ---------------------------------------------------------------------------

function combineSignals(
  signal: AbortSignal,
  requestSignal?: AbortSignal
): AbortSignal {
  return requestSignal ? AbortSignal.any([signal, requestSignal]) : signal;
}

function throwIfRequestCancelled(requestSignal?: AbortSignal): void {
  if (requestSignal?.aborted) {
    throw new Error(CANCELLED_REQUEST_MESSAGE);
  }
}

function getSleepOptions(signal?: AbortSignal): Parameters<typeof sleep>[2] {
  return signal ? { ...SLEEP_UNREF_OPTIONS, signal } : SLEEP_UNREF_OPTIONS;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseStructuredResponse(responseText: string | undefined): unknown {
  if (!responseText) {
    throw new Error('Gemini returned an empty response body.');
  }

  try {
    return JSON.parse(responseText);
  } catch {
    // fast-path failed; try extracting from markdown block
  }

  const jsonMatch = JSON_CODE_BLOCK_PATTERN.exec(responseText);
  const jsonText = jsonMatch?.[1] ?? responseText;

  try {
    return JSON.parse(jsonText);
  } catch (error: unknown) {
    throw new Error(`Model produced invalid JSON: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

// ---------------------------------------------------------------------------
// Error message formatters
// ---------------------------------------------------------------------------

function formatTimeoutErrorMessage(timeoutMs: number): string {
  return `Gemini request timed out after ${formatUsNumber(timeoutMs)}ms.`;
}

// ---------------------------------------------------------------------------
// Core generation call with timeout
// ---------------------------------------------------------------------------

async function generateContentWithTimeout(
  request: GeminiStructuredRequest,
  model: string,
  timeoutMs: number
): Promise<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timeout.unref();

  const signal = combineSignals(controller.signal, request.signal);

  try {
    return await getClient().models.generateContent({
      model,
      contents: getPromptWithFunctionCallingContext(request),
      config: buildGenerationConfig(request, signal),
    });
  } catch (error: unknown) {
    throwIfRequestCancelled(request.signal);

    if (controller.signal.aborted) {
      throw new Error(formatTimeoutErrorMessage(timeoutMs), { cause: error });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Thoughts extraction
// ---------------------------------------------------------------------------

interface ThoughtPart {
  thought: true;
  text: string;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

function isThoughtPart(part: unknown): part is ThoughtPart {
  return (
    isObject(part) &&
    part['thought'] === true &&
    typeof part['text'] === 'string'
  );
}

interface TextOnlyPart {
  text: string;
}

function isTextOnlyPart(part: unknown): part is TextOnlyPart {
  return (
    isObject(part) &&
    'text' in part &&
    typeof part['text'] === 'string' &&
    !part['thought']
  );
}

function extractThoughtsFromParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }

  const thoughtParts = parts.filter(isThoughtPart);

  if (thoughtParts.length === 0) {
    return undefined;
  }

  return thoughtParts.map((part) => part.text).join('\n\n');
}

// ---------------------------------------------------------------------------
// Code execution response extraction
// ---------------------------------------------------------------------------

interface ExecutableCodePart {
  executableCode: { code?: string; language?: string };
}

interface CodeExecutionResultPart {
  codeExecutionResult: { outcome?: string; output?: string };
}

function isExecutableCodePart(part: unknown): part is ExecutableCodePart {
  return (
    isObject(part) &&
    'executableCode' in part &&
    isObject(part['executableCode'])
  );
}

function isCodeExecutionResultPart(
  part: unknown
): part is CodeExecutionResultPart {
  return (
    isObject(part) &&
    'codeExecutionResult' in part &&
    isObject(part['codeExecutionResult'])
  );
}

function extractCodeExecutionResponse(
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>
): CodeExecutionResponse {
  const parts = response.candidates?.[0]?.content?.parts;
  const textSegments: string[] = [];
  const codeBlocks: CodeExecutionBlock[] = [];
  const executionResults: CodeExecutionResultBlock[] = [];

  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (isExecutableCodePart(part)) {
        codeBlocks.push({
          code: part.executableCode.code ?? '',
          language: part.executableCode.language ?? 'python',
        });
      } else if (isCodeExecutionResultPart(part)) {
        executionResults.push({
          outcome: part.codeExecutionResult.outcome ?? 'OUTCOME_UNSPECIFIED',
          output: part.codeExecutionResult.output ?? '',
        });
      } else if (isTextOnlyPart(part)) {
        textSegments.push(part.text);
      }
    }
  }

  return {
    text: textSegments.join('\n\n') || (response.text ?? ''),
    codeBlocks,
    executionResults,
  };
}

// ---------------------------------------------------------------------------
// Single-attempt execution
// ---------------------------------------------------------------------------

function handleExecutionResponse(
  request: GeminiStructuredRequest,
  response: GenerateContentResponse
): unknown {
  if (request.useCodeExecution) {
    return extractCodeExecutionResponse(response);
  }

  if (request.useGrounding) {
    return {
      text: response.text,
      groundingMetadata: response.candidates?.[0]?.groundingMetadata,
    };
  }

  if (request.fileSearchStoreNames && request.fileSearchStoreNames.length > 0) {
    const parts = (response.candidates?.[0]?.content?.parts ?? []) as unknown[];
    return {
      text: response.text ?? '',
      parts,
    };
  }

  return parseStructuredResponse(response.text);
}

async function executeAttempt(
  request: GeminiStructuredRequest,
  model: string,
  timeoutMs: number,
  attempt: number,
  onLog: GeminiOnLog
): Promise<unknown> {
  const startedAt = performance.now();
  const response = await generateContentWithTimeout(request, model, timeoutMs);
  const latencyMs = Math.round(performance.now() - startedAt);
  const finishReason = response.candidates?.[0]?.finishReason;
  const thoughts = extractThoughtsFromParts(
    response.candidates?.[0]?.content?.parts
  );

  await emitGeminiLog(onLog, 'info', {
    event: 'gemini_call',
    details: {
      attempt,
      latencyMs,
      finishReason: finishReason ?? null,
      usageMetadata: response.usageMetadata ?? null,
      ...(thoughts ? { thoughts } : {}),
    },
  });

  if (finishReason === FinishReason.MAX_TOKENS) {
    const limit = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    throw new Error(
      `Response truncated: model output exceeds limit (maxOutputTokens=${formatUsNumber(limit)}). Increase maxOutputTokens or reduce prompt complexity.`
    );
  }

  return handleExecutionResponse(request, response);
}

// ---------------------------------------------------------------------------
// Retry orchestration
// ---------------------------------------------------------------------------

async function waitBeforeRetry(
  attempt: number,
  error: unknown,
  onLog: GeminiOnLog,
  requestSignal?: AbortSignal
): Promise<void> {
  const delayMs = getRetryDelayMs(attempt);
  const reason = getErrorMessage(error);

  await emitGeminiLog(onLog, 'warning', {
    event: 'gemini_retry',
    details: {
      attempt,
      delayMs,
      reason,
    },
  });

  throwIfRequestCancelled(requestSignal);

  try {
    await sleep(delayMs, undefined, getSleepOptions(requestSignal));
  } catch (sleepError: unknown) {
    throwIfRequestCancelled(requestSignal);

    throw sleepError;
  }
}

async function throwGeminiFailure(
  attemptsMade: number,
  lastError: unknown,
  onLog: GeminiOnLog
): Promise<never> {
  const message = getErrorMessage(lastError);

  await emitGeminiLog(onLog, 'error', {
    event: 'gemini_failure',
    details: {
      error: message,
      attempts: attemptsMade,
    },
  });

  throw new Error(
    `Gemini request failed after ${attemptsMade} attempts: ${message}`,
    { cause: lastError }
  );
}

function countAttemptsMade(attempt: number): number {
  return attempt + 1;
}

async function runWithRetries(
  request: GeminiStructuredRequest,
  model: string,
  timeoutMs: number,
  maxRetries: number,
  onLog: GeminiOnLog
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await executeAttempt(request, model, timeoutMs, attempt, onLog);
    } catch (error: unknown) {
      lastError = error;

      if (!canRetryAttempt(attempt, maxRetries, error)) {
        return throwGeminiFailure(countAttemptsMade(attempt), lastError, onLog);
      }

      await waitBeforeRetry(attempt, error, onLog, request.signal);
    }
  }

  return throwGeminiFailure(maxRetries + 1, lastError, onLog);
}

// ---------------------------------------------------------------------------
// Batch subsystem
// ---------------------------------------------------------------------------

type ExecutionMode = 'off' | 'inline';

function isInlineBatchMode(mode: ExecutionMode): mode is 'inline' {
  return mode === 'inline';
}

async function acquireQueueSlot(
  mode: ExecutionMode,
  requestSignal?: AbortSignal
): Promise<{ queueWaitMs: number; waitingCalls: number }> {
  const queueWaitStartedAt = performance.now();

  if (isInlineBatchMode(mode)) {
    await batchCallLimiter.acquire(requestSignal);
  } else {
    await callLimiter.acquire(requestSignal);
  }

  return {
    queueWaitMs: Math.round(performance.now() - queueWaitStartedAt),
    waitingCalls: isInlineBatchMode(mode)
      ? batchCallLimiter.pendingCount
      : callLimiter.pendingCount,
  };
}

function releaseQueueSlot(mode: ExecutionMode): void {
  if (isInlineBatchMode(mode)) {
    batchCallLimiter.release();
    return;
  }
  callLimiter.release();
}

interface BatchApiClient {
  batches?: {
    create: (payload: Record<string, unknown>) => Promise<unknown>;
    get: (payload: { name: string }) => Promise<unknown>;
    cancel?: (payload: { name: string }) => Promise<unknown>;
  };
}

const BatchHelper = {
  getState(payload: unknown): string | undefined {
    const record = toRecord(payload);
    if (!record) return undefined;

    const directState = toUpperStringCode(record.state);
    if (directState) return directState;

    const metadata = toRecord(record.metadata);
    return metadata ? toUpperStringCode(metadata.state) : undefined;
  },

  getResponseText(payload: unknown): string | undefined {
    const record = toRecord(payload);
    if (!record) return undefined;

    // Try inlineResponse.text
    const inline = toRecord(record.inlineResponse);
    if (typeof inline?.text === 'string') return inline.text;

    const response = toRecord(record.response);
    if (!response) return undefined;

    // Try response.text
    if (typeof response.text === 'string') return response.text;

    // Try response.inlineResponses[0].text
    if (
      Array.isArray(response.inlineResponses) &&
      response.inlineResponses.length > 0
    ) {
      const first = toRecord(response.inlineResponses[0]);
      if (typeof first?.text === 'string') return first.text;
    }

    return undefined;
  },

  getErrorDetail(payload: unknown): string | undefined {
    const record = toRecord(payload);
    if (!record) return undefined;

    // Try error.message
    const directError = toRecord(record.error);
    if (typeof directError?.message === 'string') return directError.message;

    // Try metadata.error.message
    const metadata = toRecord(record.metadata);
    const metaError = toRecord(metadata?.error);
    if (typeof metaError?.message === 'string') return metaError.message;

    // Try response.error.message
    const response = toRecord(record.response);
    const respError = toRecord(response?.error);
    return typeof respError?.message === 'string'
      ? respError.message
      : undefined;
  },

  getSuccessResponseText(polled: unknown): string {
    const text = this.getResponseText(polled);
    if (text) return text;

    const err = this.getErrorDetail(polled);
    throw new Error(
      err
        ? `Gemini batch request succeeded but returned no response text: ${err}`
        : 'Gemini batch request succeeded but returned no response text.'
    );
  },

  handleTerminalState(state: string | undefined, payload: unknown): void {
    if (state === 'JOB_STATE_FAILED' || state === 'JOB_STATE_CANCELLED') {
      const err = this.getErrorDetail(payload);
      throw new Error(
        err
          ? `Gemini batch request ended with state ${state}: ${err}`
          : `Gemini batch request ended with state ${state}.`
      );
    }
  },
};

async function pollBatchStatusWithRetries(
  batches: NonNullable<BatchApiClient['batches']>,
  batchName: string,
  onLog: GeminiOnLog,
  requestSignal?: AbortSignal
): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_BATCH_POLL_RETRIES; attempt += 1) {
    try {
      return await batches.get({ name: batchName });
    } catch (error: unknown) {
      if (!canRetryAttempt(attempt, MAX_BATCH_POLL_RETRIES, error)) {
        throw error;
      }

      await waitBeforeRetry(attempt, error, onLog, requestSignal);
    }
  }

  throw new Error('Batch polling retries exhausted unexpectedly.');
}

async function cancelBatchIfNeeded(
  request: GeminiStructuredRequest,
  batches: NonNullable<BatchApiClient['batches']>,
  batchName: string | undefined,
  onLog: GeminiOnLog,
  completed: boolean,
  timedOut: boolean
): Promise<void> {
  const aborted = request.signal?.aborted === true;
  const shouldCancel = !completed && (aborted || timedOut);

  if (!shouldCancel || !batchName || !batches.cancel) {
    return;
  }

  const reason = timedOut ? 'timeout' : 'aborted';
  try {
    await batches.cancel({ name: batchName });
    await emitGeminiLog(onLog, 'info', {
      event: 'gemini_batch_cancelled',
      details: { batchName, reason },
    });
  } catch (error: unknown) {
    await emitGeminiLog(onLog, 'warning', {
      event: 'gemini_batch_cancel_failed',
      details: {
        batchName,
        reason,
        error: getErrorMessage(error),
      },
    });
  }
}

async function createBatchJob(
  request: GeminiStructuredRequest,
  batches: NonNullable<BatchApiClient['batches']>,
  model: string
): Promise<unknown> {
  const createPayload: Record<string, unknown> = {
    model,
    src: [
      {
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        config: buildGenerationConfig(request, request.signal),
      },
    ],
  };
  return await batches.create(createPayload);
}

async function pollBatchForCompletion(
  batches: NonNullable<BatchApiClient['batches']>,
  batchName: string,
  onLog: GeminiOnLog,
  requestSignal?: AbortSignal
): Promise<unknown> {
  const pollIntervalMs = batchPollIntervalMsConfig.get();
  const timeoutMs = batchTimeoutMsConfig.get();
  const pollStart = performance.now();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    throwIfRequestCancelled(requestSignal);

    const elapsedMs = Math.round(performance.now() - pollStart);
    if (elapsedMs > timeoutMs) {
      throw new Error(
        `Gemini batch request timed out after ${formatUsNumber(timeoutMs)}ms.`
      );
    }

    const polled = await pollBatchStatusWithRetries(
      batches,
      batchName,
      onLog,
      requestSignal
    );
    const state = BatchHelper.getState(polled);

    if (state === 'JOB_STATE_SUCCEEDED') {
      const responseText = BatchHelper.getSuccessResponseText(polled);
      return parseStructuredResponse(responseText);
    }

    BatchHelper.handleTerminalState(state, polled);
    await sleep(pollIntervalMs, undefined, getSleepOptions(requestSignal));
  }
}

async function runInlineBatchWithPolling(
  request: GeminiStructuredRequest,
  model: string,
  onLog: GeminiOnLog
): Promise<unknown> {
  // SDK batch API is not yet typed in @google/genai; cast verified by !batches guard below.
  const client = getClient() as unknown as BatchApiClient;
  const { batches } = client;
  if (!batches) {
    throw new Error(
      'Batch mode requires SDK batch support, but batches API is unavailable.'
    );
  }

  let batchName: string | undefined;
  let completed = false;
  let timedOut = false;

  try {
    const createdJob = await createBatchJob(request, batches, model);
    const createdRecord = toRecord(createdJob);
    batchName =
      typeof createdRecord?.name === 'string' ? createdRecord.name : undefined;

    if (!batchName) throw new Error('Batch mode failed to return a job name.');

    await emitGeminiLog(onLog, 'info', {
      event: 'gemini_batch_created',
      details: { batchName },
    });

    const result = await pollBatchForCompletion(
      batches,
      batchName,
      onLog,
      request.signal
    );
    completed = true;
    return result;
  } catch (error: unknown) {
    if (getErrorMessage(error).includes('timed out')) {
      timedOut = true;
    }
    throw error;
  } finally {
    await cancelBatchIfNeeded(
      request,
      batches,
      batchName,
      onLog,
      completed,
      timedOut
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getGeminiQueueSnapshot(): {
  activeWaiters: number;
  activeCalls: number;
  activeBatchWaiters: number;
  activeBatchCalls: number;
} {
  return {
    activeWaiters: callLimiter.pendingCount,
    activeCalls: callLimiter.active,
    activeBatchWaiters: batchCallLimiter.pendingCount,
    activeBatchCalls: batchCallLimiter.active,
  };
}

export async function generateWithCodeExecution(
  request: GeminiStructuredRequest
): Promise<CodeExecutionResponse> {
  return (await generateStructuredJson({
    ...request,
    useCodeExecution: true,
    responseSchema: request.responseSchema,
  })) as CodeExecutionResponse;
}

export async function generateGroundedContent(
  request: GeminiStructuredRequest
): Promise<{ text: string; groundingMetadata: unknown }> {
  return (await generateStructuredJson({
    ...request,
    useGrounding: true,
    // Provide a dummy schema if one is required by types, though it won't be used due to useGrounding check
    responseSchema: request.responseSchema,
  })) as { text: string; groundingMetadata: unknown };
}

export interface FileSearchResponse {
  text: string;
  parts: unknown[];
}

export async function generateWithFileSearch(
  request: GeminiStructuredRequest & {
    fileSearchStoreNames: readonly string[];
  }
): Promise<FileSearchResponse> {
  return (await generateStructuredJson(request)) as FileSearchResponse;
}

export async function generateStructuredJson(
  request: GeminiStructuredRequest
): Promise<unknown> {
  const model = request.model ?? getDefaultModel();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = request.maxRetries ?? DEFAULT_MAX_RETRIES;
  const batchMode = request.batchMode ?? getDefaultBatchMode();
  const { onLog } = request;
  const { queueWaitMs, waitingCalls } = await acquireQueueSlot(
    batchMode,
    request.signal
  );

  await safeCallOnLog(onLog, 'info', {
    event: 'gemini_queue_acquired',
    queueWaitMs,
    waitingCalls,
    activeCalls: callLimiter.active,
    activeBatchCalls: batchCallLimiter.active,
    mode: batchMode,
  });

  try {
    return await geminiContext.run(
      { requestId: nextRequestId(), model },
      () => {
        if (isInlineBatchMode(batchMode)) {
          return runInlineBatchWithPolling(request, model, onLog);
        }

        return runWithRetries(request, model, timeoutMs, maxRetries, onLog);
      }
    );
  } finally {
    releaseQueueSlot(batchMode);
  }
}
