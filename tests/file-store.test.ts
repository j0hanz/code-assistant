import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  disposeFileStore,
  getFile,
  initFileStore,
  setFileForTesting,
  SOURCE_RESOURCE_URI,
} from '../src/lib/file-store.js';

function createSlot(cachedAtIso: string) {
  return {
    filePath: 'C:\\code-lens\\src\\index.ts',
    content: 'export const value = 1;',
    language: 'typescript',
    lineCount: 1,
    sizeChars: 23,
    cachedAt: new Date(cachedAtIso).getTime(),
    cachedAtIso,
  };
}

describe('file-store', () => {
  it('notifies subscribers when timer-driven cleanup expires the current file', () => {
    const calls: string[] = [];
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const fakeTimer = { unref() {} } as NodeJS.Timeout;
    let cleanupCallback: (() => void) | undefined;

    global.setInterval = ((callback: () => void) => {
      cleanupCallback = callback;
      return fakeTimer;
    }) as typeof setInterval;
    global.clearInterval = (() => {}) as typeof clearInterval;

    try {
      initFileStore({
        server: {
          sendResourceUpdated: async ({ uri }: { uri: string }) => {
            calls.push(uri);
          },
        },
      } as never);

      setFileForTesting(createSlot('2000-01-01T00:00:00.000Z'));
      cleanupCallback?.();

      assert.equal(getFile(), undefined);
      assert.deepEqual(calls, [SOURCE_RESOURCE_URI]);
    } finally {
      disposeFileStore();
      setFileForTesting(undefined);
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  });
});
