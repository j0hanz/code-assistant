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
/** Interval for background cache cleanup sweeps (10 minutes). */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1_000;

/** Starts a non-blocking interval that runs {@link callback} every {@link CLEANUP_INTERVAL_MS}. */
export function startCleanupTimer(callback: () => void): NodeJS.Timeout {
  const timer = setInterval(callback, CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

/** Fast, cost-effective model for summarization and light analysis. */
export const FLASH_MODEL = 'gemini-3-flash-preview';

/** Extended timeout for deep analysis calls (ms). */
export const DEFAULT_TIMEOUT_EXTENDED_MS = 120_000;

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

/// Maximum suggestions to return for code refactoring (configurable via input). Default is 10 to balance thoroughness with cost and noise.
export const LIGHT_MAX_OUTPUT_TOKENS = 8_192;

// Higher token limit for deep analysis tasks that return large arrays or unbounded fields (e.g. test plans, documentation, code smells, verify logic).
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

// Extended token limit for tools that may return large outputs, with expectation of higher cost. Should be used judiciously and monitored for cost and performance impacts.
export const HEAVY_MAX_OUTPUT_TOKENS = 32_768;

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

/** Temperature for triage/classification tools. */
export const TRIAGE_TEMPERATURE = TOOL_TEMPERATURE.triage;
