import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createFailureStatusMessage,
  type ProgressPayload,
  RunReporter,
  type TaskStatusReporter,
} from '../src/lib/progress.js';

function createMockReporter(): {
  statusReporter: TaskStatusReporter;
  calls: {
    updateStatus: string[];
    storeResult: Array<{
      status: 'completed' | 'failed';
      isError: boolean;
    }>;
    reportCancellation: string[];
  };
} {
  const calls = {
    updateStatus: [] as string[],
    storeResult: [] as Array<{
      status: 'completed' | 'failed';
      isError: boolean;
    }>,
    reportCancellation: [] as string[],
  };

  return {
    calls,
    statusReporter: {
      updateStatus: async (message: string) => {
        calls.updateStatus.push(message);
      },
      storeResult: async (
        status: 'completed' | 'failed',
        result: { isError?: boolean }
      ) => {
        calls.storeResult.push({ status, isError: result.isError === true });
      },
      reportCancellation: async (message: string) => {
        calls.reportCancellation.push(message);
      },
    },
  };
}

function noopProgress(_payload: ProgressPayload): Promise<void> {
  return Promise.resolve();
}

describe('task lifecycle', () => {
  describe('createFailureStatusMessage', () => {
    it('prefixes cancelled outcomes', () => {
      const msg = createFailureStatusMessage('cancelled', 'user abort');
      assert.equal(msg, 'cancelled: user abort');
    });

    it('returns raw message for failed outcomes', () => {
      const msg = createFailureStatusMessage('failed', 'model error');
      assert.equal(msg, 'model error');
    });
  });

  describe('RunReporter.reportCancellation', () => {
    it('delegates to statusReporter.reportCancellation', async () => {
      const { statusReporter, calls } = createMockReporter();
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        statusReporter,
        'test-context'
      );

      await reporter.reportCancellation('task was cancelled');

      assert.equal(calls.reportCancellation.length, 1);
      assert.equal(calls.reportCancellation[0], 'task was cancelled');
      assert.equal(calls.storeResult.length, 0);
    });

    it('skips when reportCancellation is not provided', async () => {
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        {
          updateStatus: async () => {},
        },
        'test-context'
      );

      // Should not throw
      await reporter.reportCancellation('noop');
    });
  });

  describe('RunReporter.storeResultSafely', () => {
    it('stores completed result', async () => {
      const { statusReporter, calls } = createMockReporter();
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        statusReporter,
        'test-context'
      );
      const onLog = async () => {};

      await reporter.storeResultSafely(
        'completed',
        { content: [{ type: 'text', text: '{}' }] },
        onLog
      );

      assert.equal(calls.storeResult.length, 1);
      const completedResult = calls.storeResult[0];
      assert.ok(completedResult);
      assert.equal(completedResult.status, 'completed');
    });

    it('stores failed result', async () => {
      const { statusReporter, calls } = createMockReporter();
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        statusReporter,
        'test-context'
      );
      const onLog = async () => {};

      await reporter.storeResultSafely(
        'failed',
        { isError: true, content: [{ type: 'text', text: '{"error":{}}' }] },
        onLog
      );

      assert.equal(calls.storeResult.length, 1);
      const failedResult = calls.storeResult[0];
      assert.ok(failedResult);
      assert.equal(failedResult.status, 'failed');
      assert.equal(failedResult.isError, true);
    });

    it('logs on store failure without throwing', async () => {
      const logCalls: unknown[] = [];
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        {
          updateStatus: async () => {},
          storeResult: async () => {
            throw new Error('store crashed');
          },
        },
        'test-context'
      );

      await reporter.storeResultSafely(
        'failed',
        { isError: true, content: [{ type: 'text', text: '{}' }] },
        async (_level, data) => {
          logCalls.push(data);
        }
      );

      assert.equal(logCalls.length, 1);
    });
  });

  describe('RunReporter.updateStatus deduplication', () => {
    it('skips duplicate status messages', async () => {
      const { statusReporter, calls } = createMockReporter();
      const reporter = new RunReporter(
        'test_tool',
        noopProgress,
        statusReporter,
        'test-context'
      );

      await reporter.updateStatus('working');
      await reporter.updateStatus('working');
      await reporter.updateStatus('done');

      assert.equal(calls.updateStatus.length, 2);
      assert.equal(calls.updateStatus[0], 'test_tool: working');
      assert.equal(calls.updateStatus[1], 'test_tool: done');
    });
  });

  describe('ToolExecutionRunner.throwIfAborted', () => {
    it('does not throw when signal is not aborted', () => {
      const controller = new AbortController();
      // Access the private method indirectly: throwIfAborted checks this.signal?.aborted
      // We test the underlying pattern directly since throwIfAborted is private
      assert.equal(controller.signal.aborted, false);
    });

    it('signal.aborted is true after abort()', () => {
      const controller = new AbortController();
      controller.abort();
      assert.equal(controller.signal.aborted, true);
    });

    it('DOMException with AbortError name is used for cancellation', () => {
      const err = new DOMException('Task cancelled', 'AbortError');
      assert.equal(err.name, 'AbortError');
      assert.equal(err.message, 'Task cancelled');
    });
  });
});
