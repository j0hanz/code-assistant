import { HarmBlockThreshold, HarmCategory, ThinkingLevel } from '@google/genai';

import { createCachedEnvInt } from '../config.js';

// ---------------------------------------------------------------------------
// Model defaults
// ---------------------------------------------------------------------------

// Lazy-cached: first call happens after parseCommandLineArgs() sets GEMINI_MODEL.
let _defaultModel: string | undefined;
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const GEMINI_MODEL_ENV_VAR = 'GEMINI_MODEL';

export function getDefaultModel(): string {
  _defaultModel ??= process.env[GEMINI_MODEL_ENV_VAR] ?? DEFAULT_MODEL;
  return _defaultModel;
}

/** Test-only: reset cached model so env changes take effect. */
export function resetDefaultModelForTesting(): void {
  _defaultModel = undefined;
}

// ---------------------------------------------------------------------------
// Execution defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_TOP_K = 40;
export const DEFAULT_TOP_P = 0.95;
export const CANCELLED_REQUEST_MESSAGE = 'Gemini request was cancelled.';
const UNKNOWN_REQUEST_CONTEXT_VALUE_STR = 'unknown';
export { UNKNOWN_REQUEST_CONTEXT_VALUE_STR as UNKNOWN_REQUEST_CONTEXT_VALUE };

// ---------------------------------------------------------------------------
// Safety settings
// ---------------------------------------------------------------------------

const GEMINI_HARM_BLOCK_THRESHOLD_ENV_VAR = 'GEMINI_HARM_BLOCK_THRESHOLD';
const DEFAULT_SAFETY_THRESHOLD = HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE;

const SAFETY_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
] as const;

const SAFETY_THRESHOLD_BY_NAME = {
  BLOCK_NONE: HarmBlockThreshold.BLOCK_NONE,
  BLOCK_ONLY_HIGH: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  BLOCK_MEDIUM_AND_ABOVE: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  BLOCK_LOW_AND_ABOVE: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
} as const;

function createCachedEnvParser<T>(
  envKey: string,
  parser: (raw: string) => T | undefined,
  defaultValue: T
): () => T {
  let cachedRaw: string | undefined;
  let cachedParsed = defaultValue;

  return () => {
    const raw = process.env[envKey];
    if (raw === cachedRaw) return cachedParsed;

    cachedRaw = raw;
    if (!raw) {
      cachedParsed = defaultValue;
      return cachedParsed;
    }

    cachedParsed = parser(raw) ?? defaultValue;
    return cachedParsed;
  };
}

const SAFETY_THRESHOLDS = [
  HarmBlockThreshold.BLOCK_NONE,
  HarmBlockThreshold.BLOCK_ONLY_HIGH,
  HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
] as const;

const SAFETY_SETTINGS_MAP = Object.fromEntries(
  SAFETY_THRESHOLDS.map((threshold) => [
    threshold,
    SAFETY_CATEGORIES.map((category) => ({ category, threshold })),
  ])
) as Record<
  HarmBlockThreshold,
  { category: HarmCategory; threshold: HarmBlockThreshold }[]
>;

function parseSafetyThreshold(
  threshold: string
): HarmBlockThreshold | undefined {
  const normalizedThreshold = threshold.trim().toUpperCase();
  if (!(normalizedThreshold in SAFETY_THRESHOLD_BY_NAME)) {
    return undefined;
  }

  return SAFETY_THRESHOLD_BY_NAME[
    normalizedThreshold as keyof typeof SAFETY_THRESHOLD_BY_NAME
  ];
}

export const getSafetyThreshold = createCachedEnvParser(
  GEMINI_HARM_BLOCK_THRESHOLD_ENV_VAR,
  parseSafetyThreshold,
  DEFAULT_SAFETY_THRESHOLD
);

export function getSafetySettings(
  threshold: HarmBlockThreshold
): { category: HarmCategory; threshold: HarmBlockThreshold }[] {
  return SAFETY_SETTINGS_MAP[threshold];
}

// ---------------------------------------------------------------------------
// Thinking config
// ---------------------------------------------------------------------------

const THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export function getThinkingConfig(
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | undefined,
  includeThoughts: boolean
): { thinkingLevel?: ThinkingLevel; includeThoughts?: true } | undefined {
  if (!thinkingLevel && !includeThoughts) {
    return undefined;
  }

  return {
    ...(thinkingLevel
      ? { thinkingLevel: THINKING_LEVEL_MAP[thinkingLevel] }
      : {}),
    ...(includeThoughts ? { includeThoughts: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Boolean / env helpers
// ---------------------------------------------------------------------------

const GEMINI_INCLUDE_THOUGHTS_ENV_VAR = 'GEMINI_INCLUDE_THOUGHTS';
const GEMINI_BATCH_MODE_ENV_VAR = 'GEMINI_BATCH_MODE';
const DEFAULT_INCLUDE_THOUGHTS = false;
const DEFAULT_BATCH_MODE = 'off';
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseBooleanEnv(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }

  return undefined;
}

export const getDefaultIncludeThoughts = createCachedEnvParser(
  GEMINI_INCLUDE_THOUGHTS_ENV_VAR,
  parseBooleanEnv,
  DEFAULT_INCLUDE_THOUGHTS
);

export const getDefaultBatchMode = createCachedEnvParser<'off' | 'inline'>(
  GEMINI_BATCH_MODE_ENV_VAR,
  (val: string) =>
    val.trim().toLowerCase() === 'inline' ? 'inline' : undefined,
  DEFAULT_BATCH_MODE
);

// ---------------------------------------------------------------------------
// Concurrency env configs
// ---------------------------------------------------------------------------

export const maxConcurrentCallsConfig = createCachedEnvInt(
  'MAX_CONCURRENT_CALLS',
  10
);
export const maxConcurrentBatchCallsConfig = createCachedEnvInt(
  'MAX_CONCURRENT_BATCH_CALLS',
  2
);
export const concurrencyWaitMsConfig = createCachedEnvInt(
  'MAX_CONCURRENT_CALLS_WAIT_MS',
  2_000
);
export const batchPollIntervalMsConfig = createCachedEnvInt(
  'GEMINI_BATCH_POLL_INTERVAL_MS',
  2_000
);
export const batchTimeoutMsConfig = createCachedEnvInt(
  'GEMINI_BATCH_TIMEOUT_MS',
  120_000
);
