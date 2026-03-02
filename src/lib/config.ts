export interface CachedEnvInt {
  get(): number;
  reset(): void;
}

function parseNonNegativeInteger(value: string): number | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function resolveEnvInt(envVar: string, defaultValue: number): number {
  const envValue = process.env[envVar] ?? '';
  return parseNonNegativeInteger(envValue) ?? defaultValue;
}

/** Creates a cached integer value from an environment variable, with a default fallback. */
export function createCachedEnvInt(
  envVar: string,
  defaultValue: number
): CachedEnvInt {
  let cached: number | undefined;

  return {
    get(): number {
      if (cached !== undefined) {
        return cached;
      }

      cached = resolveEnvInt(envVar, defaultValue);
      return cached;
    },

    reset(): void {
      cached = undefined;
    },
  };
}
/** Fast, cost-effective model for summarization and light analysis. */
export const FLASH_MODEL = 'gemini-3-flash-preview';

/** Default language hint. */
export const DEFAULT_LANGUAGE = 'detect';

/** Default test-framework hint. */
export const DEFAULT_FRAMEWORK = 'detect';

/** Extended timeout for deep analysis calls (ms). */
export const DEFAULT_TIMEOUT_EXTENDED_MS = 120_000;

export const MODEL_TIMEOUT_MS = Object.freeze({
  extended: DEFAULT_TIMEOUT_EXTENDED_MS,
} as const);

// ---------------------------------------------------------------------------
// Budgets (Thinking & Output)
// ---------------------------------------------------------------------------

const THINKING_LEVELS = {
  /** Minimal thinking for triage/classification. */
  flashTriage: 'minimal',
  /** Medium thinking for analysis tasks. */
  flash: 'medium',
  /** High thinking for deep review and patches. */
  flashHigh: 'high',
} as const;

/** Thinking level for Flash triage. */
export const FLASH_TRIAGE_THINKING_LEVEL = THINKING_LEVELS.flashTriage;

/** Thinking level for Flash analysis. */
export const FLASH_THINKING_LEVEL = THINKING_LEVELS.flash;

/** Thinking level for Flash deep analysis. */
export const FLASH_HIGH_THINKING_LEVEL = THINKING_LEVELS.flashHigh;

// Output token caps for various tools. Set to a high default to avoid cutting off important information, but can be adjusted as needed.
const DEFAULT_OUTPUT_CAP = 65_536;

/** Shared output token cap used by all tool categories. */
export const DEFAULT_MAX_OUTPUT_TOKENS = DEFAULT_OUTPUT_CAP;

// ---------------------------------------------------------------------------
// Temperatures
// ---------------------------------------------------------------------------

// Gemini 3 recommends temperature 1.0 for all tasks.
// Separate constants are retained so per-category tuning is possible
// if future models or workloads warrant different values.
const TOOL_TEMPERATURE = {
  analysis: 1.0,
  creative: 1.0,
  patch: 1.0,
  triage: 1.0,
} as const;

/** Temperature for analytical tools. */
export const ANALYSIS_TEMPERATURE = TOOL_TEMPERATURE.analysis;

/** Temperature for creative synthesis (test plans). */
export const CREATIVE_TEMPERATURE = TOOL_TEMPERATURE.creative;

/** Temperature for code patch generation. */
export const PATCH_TEMPERATURE = TOOL_TEMPERATURE.patch;

/** Temperature for triage/classification tools. */
export const TRIAGE_TEMPERATURE = TOOL_TEMPERATURE.triage;
