import { debuglog } from 'node:util';

import { getClient } from './client.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const debug = debuglog('gemini:search-store');

export interface SearchStoreSlot {
  storeName: string;
  displayName: string;
  documentCount: number;
  createdAt: number;
}

let currentStore: SearchStoreSlot | undefined;

// ---------------------------------------------------------------------------
// Store lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new Gemini File Search Store.
 * Returns the store name on success, or undefined on failure (logged).
 */
export async function createSearchStore(
  displayName: string
): Promise<string | undefined> {
  try {
    const store = await getClient().fileSearchStores.create({
      config: { displayName },
    });

    if (!store.name) {
      debug('Store created but no name returned');
      return undefined;
    }

    debug('Search store created: %s', store.name);
    return store.name;
  } catch (error: unknown) {
    debug('Failed to create search store: %O', error);
    return undefined;
  }
}

/**
 * Upload in-memory file content to a File Search Store.
 * Returns the document name on success, or undefined on failure.
 */
export async function uploadToSearchStore(
  storeName: string,
  fileName: string,
  content: string,
  mimeType: string
): Promise<string | undefined> {
  try {
    const blob = new Blob([content], { type: mimeType });
    const operation =
      await getClient().fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeName,
        file: blob,
        config: { mimeType, displayName: fileName },
      });

    debug('Upload to store %s: operation=%s', storeName, operation.name);
    return operation.response?.documentName;
  } catch (error: unknown) {
    debug('Failed to upload %s to store %s: %O', fileName, storeName, error);
    return undefined;
  }
}

/**
 * Get store info from the API. Returns undefined on failure.
 */
export async function getSearchStoreInfo(storeName: string): Promise<
  | {
      name: string;
      activeDocuments: number;
      pendingDocuments: number;
      failedDocuments: number;
      sizeBytes: number;
    }
  | undefined
> {
  try {
    const store = await getClient().fileSearchStores.get({ name: storeName });

    return {
      name: store.name ?? storeName,
      activeDocuments:
        Number.parseInt(store.activeDocumentsCount ?? '0', 10) || 0,
      pendingDocuments:
        Number.parseInt(store.pendingDocumentsCount ?? '0', 10) || 0,
      failedDocuments:
        Number.parseInt(store.failedDocumentsCount ?? '0', 10) || 0,
      sizeBytes: Number.parseInt(store.sizeBytes ?? '0', 10) || 0,
    };
  } catch (error: unknown) {
    debug('Failed to get store info for %s: %O', storeName, error);
    return undefined;
  }
}

/**
 * Delete a File Search Store from the API (with force=true to remove documents).
 * Best-effort: errors are logged but not thrown.
 */
export async function deleteSearchStore(storeName: string): Promise<void> {
  try {
    await getClient().fileSearchStores.delete({
      name: storeName,
      config: { force: true },
    });
    debug('Search store deleted: %s', storeName);
  } catch (error: unknown) {
    debug('Failed to delete search store %s: %O', storeName, error);
  }
}

// ---------------------------------------------------------------------------
// Current store state management
// ---------------------------------------------------------------------------

export function getCurrentSearchStore(): SearchStoreSlot | undefined {
  return currentStore;
}

export function setCurrentSearchStore(slot: SearchStoreSlot): void {
  currentStore = slot;
}

/** Clear local state without API call. */
export function clearSearchStoreLocal(): void {
  currentStore = undefined;
}

/** Expose for testing. */
export function setSearchStoreForTesting(
  slot: SearchStoreSlot | undefined
): void {
  currentStore = slot;
}
