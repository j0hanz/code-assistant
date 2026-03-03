import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConcurrencyLimiter } from '../src/lib/concurrency.js';

function createLimiter(max = 2, timeoutMs = 500): ConcurrencyLimiter {
  return new ConcurrencyLimiter(
    () => max,
    () => timeoutMs,
    (limit, timeout) =>
      `Concurrency limit ${String(limit)} reached, timed out after ${String(timeout)}ms`,
    () => 'Request was cancelled'
  );
}

describe('ConcurrencyLimiter', () => {
  describe('acquire and release', () => {
    it('resolves immediately when under the limit', async () => {
      const limiter = createLimiter(2);
      await limiter.acquire();
      assert.equal(limiter.active, 1);
      assert.equal(limiter.pendingCount, 0);
      limiter.release();
      assert.equal(limiter.active, 0);
    });

    it('allows concurrent acquires up to the limit', async () => {
      const limiter = createLimiter(3);
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();
      assert.equal(limiter.active, 3);
      limiter.release();
      assert.equal(limiter.active, 2);
    });

    it('queues waiters when at the limit', async () => {
      const limiter = createLimiter(1);
      await limiter.acquire();
      assert.equal(limiter.active, 1);

      let resolved = false;
      const pending = limiter.acquire().then(() => {
        resolved = true;
      });

      // Give the microtask queue a tick
      await Promise.resolve();
      assert.equal(resolved, false);
      assert.equal(limiter.pendingCount, 1);

      limiter.release();
      await pending;
      assert.equal(resolved, true);
      assert.equal(limiter.active, 1);
      assert.equal(limiter.pendingCount, 0);
      limiter.release();
    });

    it('processes waiters in FIFO order', async () => {
      const limiter = createLimiter(1);
      await limiter.acquire();

      const order: number[] = [];
      const p1 = limiter.acquire().then(() => {
        order.push(1);
      });
      const p2 = limiter.acquire().then(() => {
        order.push(2);
      });

      limiter.release();
      await p1;
      limiter.release();
      await p2;

      assert.deepEqual(order, [1, 2]);
      limiter.release();
    });

    it('release is a no-op when active count is zero', () => {
      const limiter = createLimiter(1);
      // Should not throw or go negative
      limiter.release();
      assert.equal(limiter.active, 0);
    });
  });

  describe('timeout', () => {
    it('rejects with timeout error after waitTimeoutMs', async () => {
      const limiter = createLimiter(1, 50);
      await limiter.acquire();

      await assert.rejects(
        () => limiter.acquire(),
        (error: Error) => {
          assert.match(error.message, /timed out/i);
          return true;
        }
      );

      assert.equal(limiter.pendingCount, 0);
      limiter.release();
    });

    it('cleans up waiter from set on timeout', async () => {
      const limiter = createLimiter(1, 50);
      await limiter.acquire();

      await assert.rejects(() => limiter.acquire());
      assert.equal(limiter.pendingCount, 0);
      limiter.release();
    });
  });

  describe('abort signal', () => {
    it('rejects immediately when signal is already aborted', async () => {
      const limiter = createLimiter(1);
      await limiter.acquire();

      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () => limiter.acquire(controller.signal),
        (error: Error) => {
          assert.match(error.message, /cancelled/i);
          return true;
        }
      );

      assert.equal(limiter.pendingCount, 0);
      limiter.release();
    });

    it('rejects when signal is aborted while waiting', async () => {
      const limiter = createLimiter(1, 5000);
      await limiter.acquire();

      const controller = new AbortController();
      const pending = limiter.acquire(controller.signal);

      assert.equal(limiter.pendingCount, 1);
      controller.abort();

      await assert.rejects(
        () => pending,
        (error: Error) => {
          assert.match(error.message, /cancelled/i);
          return true;
        }
      );

      assert.equal(limiter.pendingCount, 0);
      limiter.release();
    });

    it('does not reject if released before abort', async () => {
      const limiter = createLimiter(1, 5000);
      await limiter.acquire();

      const controller = new AbortController();
      const pending = limiter.acquire(controller.signal);

      limiter.release();
      await pending;

      // Aborting after resolve should be a no-op
      controller.abort();
      assert.equal(limiter.active, 1);
      limiter.release();
    });
  });

  describe('dynamic limits', () => {
    it('uses the current value of maxConcurrent on each acquire', async () => {
      let max = 1;
      const limiter = new ConcurrencyLimiter(
        () => max,
        () => 500,
        (limit, timeout) =>
          `Limit ${String(limit)}, timeout ${String(timeout)}ms`,
        () => 'Cancelled'
      );

      await limiter.acquire();
      assert.equal(limiter.active, 1);

      // Increase limit dynamically
      max = 2;
      await limiter.acquire();
      assert.equal(limiter.active, 2);

      limiter.release();
      limiter.release();
    });
  });
});
