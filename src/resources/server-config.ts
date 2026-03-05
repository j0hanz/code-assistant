import { FLASH_MODEL } from '../lib/config.js';
import { getMaxDiffChars } from '../lib/diff.js';
import {
  formatThinkingLevel,
  formatTimeoutSeconds,
  formatUsNumber,
} from '../lib/format.js';
import { toInlineCode } from '../lib/format.js';
import {
  concurrencyWaitMsConfig,
  maxConcurrentBatchCallsConfig,
  maxConcurrentCallsConfig,
} from '../lib/gemini/config.js';
import {
  getMaxTaskTtlMs,
  getTaskTtlMs,
  getToolContracts,
} from '../lib/tools.js';

const DEFAULT_SAFETY_THRESHOLD = 'BLOCK_MEDIUM_AND_ABOVE';

const GEMINI_HARM_BLOCK_THRESHOLD_ENV_VAR = 'GEMINI_HARM_BLOCK_THRESHOLD';
const GEMINI_MODEL_ENV_VAR = 'GEMINI_MODEL';
const GEMINI_BATCH_MODE_ENV_VAR = 'GEMINI_BATCH_MODE';

function getModelOverride(): string {
  return process.env[GEMINI_MODEL_ENV_VAR] ?? FLASH_MODEL;
}

function getBatchMode(): string {
  return process.env[GEMINI_BATCH_MODE_ENV_VAR] ?? 'off';
}

function getSafetyThreshold(): string {
  return (
    process.env[GEMINI_HARM_BLOCK_THRESHOLD_ENV_VAR] ?? DEFAULT_SAFETY_THRESHOLD
  );
}

export function buildServerConfig(): string {
  const maxDiffChars = getMaxDiffChars();
  const maxConcurrent = maxConcurrentCallsConfig.get();
  const maxConcurrentBatch = maxConcurrentBatchCallsConfig.get();
  const concurrentWaitMs = concurrencyWaitMsConfig.get();
  const taskTtlMs = getTaskTtlMs();
  const maxTaskTtlMs = getMaxTaskTtlMs();
  const defaultModel = getModelOverride();
  const batchMode = getBatchMode();
  const safetyThreshold = getSafetyThreshold();
  const toolRows = getToolContracts()
    .filter((contract) => contract.model !== 'none')
    .map((contract) => {
      return `| ${toInlineCode(contract.name)} | ${toInlineCode(contract.model)} | ${formatThinkingLevel(contract.thinkingLevel, '—')} | ${formatTimeoutSeconds(contract.timeoutMs)} | ${formatUsNumber(contract.maxOutputTokens)} |`;
    })
    .join('\n');

  return `# Server Configuration

## Input Limits

| Limit | Value | Env |
|-------|-------|-----|
| Diff limit | ${formatUsNumber(maxDiffChars)} chars | ${toInlineCode('MAX_DIFF_CHARS')} |
| Concurrency limit | ${maxConcurrent} | ${toInlineCode('MAX_CONCURRENT_CALLS')} |
| Batch concurrency limit | ${maxConcurrentBatch} | ${toInlineCode('MAX_CONCURRENT_BATCH_CALLS')} |
| Wait timeout | ${formatUsNumber(concurrentWaitMs)}ms | ${toInlineCode('MAX_CONCURRENT_CALLS_WAIT_MS')} |
| Default task TTL | ${formatUsNumber(taskTtlMs)}ms | ${toInlineCode('TASK_TTL_MS')} |
| Max task TTL | ${maxTaskTtlMs === 0 ? 'unlimited' : `${formatUsNumber(maxTaskTtlMs)}ms`} | ${toInlineCode('MAX_TASK_TTL_MS')} |
| Batch mode | ${batchMode} | ${toInlineCode('GEMINI_BATCH_MODE')} |

## Model Assignments

Default model: ${toInlineCode(defaultModel)} (override with ${toInlineCode('GEMINI_MODEL')})

| Tool | Model | Thinking Level | Timeout | Max Output Tokens |
|------|-------|----------------|---------|-------------------|
${toolRows}

## Safety

- Harm block threshold: ${toInlineCode(safetyThreshold)}
- Override with ${toInlineCode('GEMINI_HARM_BLOCK_THRESHOLD')} (BLOCK_NONE, BLOCK_ONLY_HIGH, BLOCK_MEDIUM_AND_ABOVE, BLOCK_LOW_AND_ABOVE)

## API Keys

- Set ${toInlineCode('GEMINI_API_KEY')} or ${toInlineCode('GOOGLE_API_KEY')} environment variable (required)

## Batch Mode

- ${toInlineCode('GEMINI_BATCH_MODE')}: ${toInlineCode('off')} (default) or ${toInlineCode('inline')}
- ${toInlineCode('GEMINI_BATCH_POLL_INTERVAL_MS')}: poll cadence for batch status checks
- ${toInlineCode('GEMINI_BATCH_TIMEOUT_MS')}: max wait for batch completion

## Tasks

- Requestors may provide a task TTL; the server honors it up to ${toInlineCode('MAX_TASK_TTL_MS')}.
- If the request does not specify a TTL, the server uses ${toInlineCode('TASK_TTL_MS')}.
- Set ${toInlineCode('MAX_TASK_TTL_MS')} to ${toInlineCode('0')} to disable the cap.
`;
}
