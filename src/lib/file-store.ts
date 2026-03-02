import { performance } from 'node:perf_hooks';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createCachedEnvInt } from './config.js';
import { formatUsNumber } from './format.js';
import { createErrorToolResponse, type ErrorMeta } from './tools.js';

// --- File Budget ---

const DEFAULT_MAX_FILE_CHARS = 120_000;
const MAX_FILE_CHARS_ENV_VAR = 'MAX_FILE_CHARS';

const fileCharsConfig = createCachedEnvInt(
  MAX_FILE_CHARS_ENV_VAR,
  DEFAULT_MAX_FILE_CHARS
);

export function getMaxFileChars(): number {
  return fileCharsConfig.get();
}

export function resetMaxFileCharsCacheForTesting(): void {
  fileCharsConfig.reset();
}

const BUDGET_ERROR_META: ErrorMeta = { retryable: false, kind: 'budget' };

export function validateFileBudget(
  content: string
): ReturnType<typeof createErrorToolResponse> | undefined {
  const providedChars = content.length;
  const maxChars = getMaxFileChars();
  if (providedChars <= maxChars) {
    return undefined;
  }

  return createErrorToolResponse(
    'E_INPUT_TOO_LARGE',
    `File exceeds max allowed size (${formatUsNumber(providedChars)} chars > ${formatUsNumber(maxChars)} chars)`,
    { providedChars, maxChars },
    BUDGET_ERROR_META
  );
}

// --- File Store ---

export const SOURCE_RESOURCE_URI = 'internal://file/current';

const fileCacheTtlMs = createCachedEnvInt(
  'FILE_CACHE_TTL_MS',
  60 * 60 * 1_000 // 1 hour default
);

export const fileStaleWarningMs = createCachedEnvInt(
  'FILE_STALE_WARNING_MS',
  5 * 60 * 1_000 // 5 minutes default
);

export interface FileSlot {
  filePath: string;
  content: string;
  language: string;
  lineCount: number;
  sizeChars: number;
  cachedAt: number;
}

type SendResourceUpdated = (params: { uri: string }) => Promise<void>;

let currentSlot: FileSlot | undefined;
let sendResourceUpdated: SendResourceUpdated | undefined;

function notifyFileUpdated(): void {
  void sendResourceUpdated?.({ uri: SOURCE_RESOURCE_URI }).catch(() => {
    // Ignore errors sending resource-updated
  });
}

/** Binds file resource notifications to the currently active server instance. */
export function initFileStore(server: McpServer): void {
  sendResourceUpdated = (params) => server.server.sendResourceUpdated(params);
}

export function storeFile(slot: FileSlot): void {
  currentSlot = slot;
  notifyFileUpdated();
}

export function getFile(): FileSlot | undefined {
  if (!currentSlot) {
    return undefined;
  }

  const age = performance.now() - currentSlot.cachedAt;
  if (age > fileCacheTtlMs.get()) {
    currentSlot = undefined;
    notifyFileUpdated();
    return undefined;
  }

  return currentSlot;
}

export function hasFile(): boolean {
  return getFile() !== undefined;
}

/** Test-only: directly set or clear the file slot without emitting resource-updated. */
export function setFileForTesting(slot: FileSlot | undefined): void {
  currentSlot = slot;
}

export function createNoFileError(): ReturnType<
  typeof createErrorToolResponse
> {
  return createErrorToolResponse(
    'E_NO_FILE',
    'No file cached. You must call the load_file tool before using any file analysis tool. Run load_file with the absolute path to the file, then retry this tool.',
    undefined,
    { retryable: false, kind: 'validation' }
  );
}
