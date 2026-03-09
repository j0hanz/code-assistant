import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createNoDiffError,
  DIFF_RESOURCE_URI,
  disposeDiffStore,
  getDiff,
  hasDiff,
  initDiffStore,
  setDiffForTesting,
  storeDiff,
} from '../src/lib/diff.js';

function createSlot(generatedAt: string) {
  return {
    diff: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
    diffHash: 'a-hash',
    parsedFiles: [],
    stats: { files: 1, added: 1, deleted: 1 },
    generatedAt,
    generatedAtMs: new Date(generatedAt).getTime(),
    mode: 'unstaged',
    repository: 'owner/repo',
  };
}

describe('diff-store', () => {
  it('stores and retrieves diff slots by key', () => {
    const key = `${process.cwd()}:diff-store-test:store`;
    const slot = createSlot(new Date().toISOString());

    setDiffForTesting(undefined, key);
    assert.equal(hasDiff(key), false);

    storeDiff(slot, key);

    assert.equal(hasDiff(key), true);
    assert.deepEqual(getDiff(key), slot);

    setDiffForTesting(undefined, key);
    assert.equal(getDiff(key), undefined);
  });

  it('expires stale diff slots based on generatedAt timestamp', () => {
    const key = `${process.cwd()}:diff-store-test:expired`;
    const oldSlot = createSlot('2000-01-01T00:00:00.000Z');

    setDiffForTesting(oldSlot, key);
    assert.equal(getDiff(key), undefined);
    assert.equal(hasDiff(key), false);
  });

  it('is safe to initialize with a server missing sendResourceUpdated', () => {
    initDiffStore({} as never);
    initDiffStore({} as never);
    assert.ok(true);
  });

  it('rebinds diff update notifications when initialized with a new server', () => {
    const key = `${process.cwd()}:diff-store-test:rebind`;
    const calls: string[] = [];
    const slot = createSlot(new Date().toISOString());

    const firstServer = {
      server: {
        sendResourceUpdated: async ({ uri }: { uri: string }) => {
          calls.push(`first:${uri}`);
        },
      },
    };
    const secondServer = {
      server: {
        sendResourceUpdated: async ({ uri }: { uri: string }) => {
          calls.push(`second:${uri}`);
        },
      },
    };

    setDiffForTesting(undefined, key);
    initDiffStore(firstServer as never);
    storeDiff(slot, key);

    initDiffStore(secondServer as never);
    storeDiff(slot, key);

    assert.equal(calls[0], `first:${DIFF_RESOURCE_URI}`);
    assert.equal(calls[1], `second:${DIFF_RESOURCE_URI}`);

    setDiffForTesting(undefined, key);
  });

  it('notifies subscribers when timer-driven cleanup expires the current diff', () => {
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
      initDiffStore({
        server: {
          sendResourceUpdated: async ({ uri }: { uri: string }) => {
            calls.push(uri);
          },
        },
      } as never);

      setDiffForTesting(createSlot('2000-01-01T00:00:00.000Z'));
      cleanupCallback?.();

      assert.equal(getDiff(), undefined);
      assert.deepEqual(calls, [DIFF_RESOURCE_URI]);
    } finally {
      disposeDiffStore();
      setDiffForTesting(undefined);
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  });

  it('creates a no-diff validation error payload', () => {
    const error = createNoDiffError();
    assert.equal(error.isError, true);

    const first = error.content[0];
    assert.ok(first && 'text' in first);
    const parsed = JSON.parse(first.text) as {
      ok: boolean;
      error?: {
        code: string;
        message: string;
        kind?: string;
        retryable?: boolean;
      };
    };

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error?.code, 'E_NO_DIFF');
    assert.equal(parsed.error?.kind, 'validation');
    assert.equal(parsed.error?.retryable, false);
    assert.match(
      parsed.error?.message ?? '',
      /must call the generate_diff tool/i
    );
  });
});
