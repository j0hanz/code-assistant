import { debuglog } from 'node:util';

import { getClient } from './client.js';
import { getDefaultModel } from './config.js';

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

const GEMINI_DIFF_CACHE_ENABLED_ENV = 'GEMINI_DIFF_CACHE_ENABLED';
const GEMINI_DIFF_CACHE_TTL_S_ENV = 'GEMINI_DIFF_CACHE_TTL_S';
const DEFAULT_CACHE_TTL_S = 3600; // 1 hour
const MIN_DIFF_CHARS_FOR_CACHING = 30_000;

const debug = debuglog('gemini:cache');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface DiffCacheSlot {
  cacheName: string;
  model: string;
  createdAt: number;
}

let currentCache: DiffCacheSlot | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isDiffCacheEnabled(): boolean {
  const value = process.env[GEMINI_DIFF_CACHE_ENABLED_ENV];
  return value === '1' || value === 'true';
}

function getCacheTtlSeconds(): number {
  const raw = process.env[GEMINI_DIFF_CACHE_TTL_S_ENV];
  if (!raw) return DEFAULT_CACHE_TTL_S;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CACHE_TTL_S;
}

export function shouldCacheDiff(diffLength: number): boolean {
  return isDiffCacheEnabled() && diffLength >= MIN_DIFF_CHARS_FOR_CACHING;
}

// ---------------------------------------------------------------------------
// Cache lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a Gemini context cache containing the given diff text.
 * Returns the cache slot on success, or undefined on failure (logged).
 */
export async function createDiffCache(
  diff: string,
  model?: string
): Promise<DiffCacheSlot | undefined> {
  const effectiveModel = model ?? getDefaultModel();
  const ttl = `${String(getCacheTtlSeconds())}s`;

  try {
    const cache = await getClient().caches.create({
      model: effectiveModel,
      config: {
        contents: [{ role: 'user', parts: [{ text: diff }] }],
        displayName: 'code-lens-diff',
        ttl,
      },
    });

    if (!cache.name) {
      debug('Cache created but no name returned');
      return undefined;
    }

    const slot: DiffCacheSlot = {
      cacheName: cache.name,
      model: effectiveModel,
      createdAt: Date.now(),
    };
    currentCache = slot;
    debug('Diff cache created: %s (model=%s)', cache.name, effectiveModel);
    return slot;
  } catch (error: unknown) {
    debug('Failed to create diff cache: %O', error);
    return undefined;
  }
}

/**
 * Returns the current diff cache slot if the model matches.
 * Falls back to undefined when:
 * - No cache exists
 * - The cache was created for a different model
 */
export function getCurrentDiffCache(model?: string): DiffCacheSlot | undefined {
  if (!currentCache) return undefined;

  const effectiveModel = model ?? getDefaultModel();
  if (currentCache.model !== effectiveModel) {
    debug(
      'Cache model mismatch: cached=%s, requested=%s',
      currentCache.model,
      effectiveModel
    );
    return undefined;
  }

  return currentCache;
}

/**
 * Delete the current diff cache from the Gemini API and clear local state.
 * Best-effort: errors are logged but not thrown.
 */
export async function deleteDiffCache(): Promise<void> {
  const slot = currentCache;
  currentCache = undefined;

  if (!slot) return;

  try {
    await getClient().caches.delete({ name: slot.cacheName });
    debug('Diff cache deleted: %s', slot.cacheName);
  } catch (error: unknown) {
    debug('Failed to delete diff cache: %O', error);
  }
}

/** Clear local cache state without calling the API. */
export function clearDiffCacheLocal(): void {
  currentCache = undefined;
}

/** Expose for testing. */
export function setDiffCacheForTesting(slot: DiffCacheSlot | undefined): void {
  currentCache = slot;
}
