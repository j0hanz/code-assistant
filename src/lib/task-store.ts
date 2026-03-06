import type { TaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import type { Result } from '@modelcontextprotocol/sdk/types.js';

import { createErrorToolResponse } from './tool-response.js';

export interface CancelledTaskResultStore extends TaskStore {
  storeCancelledTaskResult(taskId: string, result: Result): Promise<void>;
  getTaskAbortSignal(taskId: string): AbortSignal;
  cleanup(): void;
}

interface CleanupCapable {
  cleanup(): void;
}

function hasCleanup(value: TaskStore): value is TaskStore & CleanupCapable {
  return 'cleanup' in value && typeof value.cleanup === 'function';
}

export function hasCancelledTaskResultStore(
  store: object
): store is CancelledTaskResultStore {
  return (
    'storeCancelledTaskResult' in store &&
    typeof store.storeCancelledTaskResult === 'function' &&
    'getTaskAbortSignal' in store &&
    typeof store.getTaskAbortSignal === 'function'
  );
}

export class CodeLensTaskStore implements CancelledTaskResultStore {
  private readonly base: TaskStore;
  private readonly cancelledResults = new Map<string, Result>();
  private readonly cancelledResultTimers = new Map<string, NodeJS.Timeout>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(base: TaskStore = new InMemoryTaskStore()) {
    this.base = base;
  }

  getTaskAbortSignal(taskId: string): AbortSignal {
    let controller = this.abortControllers.get(taskId);
    if (!controller) {
      controller = new AbortController();
      this.abortControllers.set(taskId, controller);
    }
    return controller.signal;
  }

  private clearCancelledTaskResult(taskId: string): void {
    const timer = this.cancelledResultTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.cancelledResultTimers.delete(taskId);
    }

    this.cancelledResults.delete(taskId);
    this.abortControllers.delete(taskId);
  }

  private async scheduleCancelledTaskCleanup(taskId: string): Promise<void> {
    const task = await this.base.getTask(taskId);
    const ttl = task?.ttl;
    if (!ttl || ttl <= 0) {
      return;
    }

    const existingTimer = this.cancelledResultTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.cancelledResults.delete(taskId);
      this.cancelledResultTimers.delete(taskId);
    }, ttl);
    timer.unref();

    this.cancelledResultTimers.set(taskId, timer);
  }

  async createTask(
    ...args: Parameters<TaskStore['createTask']>
  ): ReturnType<TaskStore['createTask']> {
    const task = await this.base.createTask(...args);
    this.clearCancelledTaskResult(task.taskId);
    return task;
  }

  async getTask(
    ...args: Parameters<TaskStore['getTask']>
  ): ReturnType<TaskStore['getTask']> {
    const task = await this.base.getTask(...args);
    const taskId = args[0];
    if (task === null) {
      this.clearCancelledTaskResult(taskId);
    }

    return task;
  }

  async storeTaskResult(
    ...args: Parameters<TaskStore['storeTaskResult']>
  ): ReturnType<TaskStore['storeTaskResult']> {
    this.clearCancelledTaskResult(args[0]);
    await this.base.storeTaskResult(...args);
  }

  async storeCancelledTaskResult(
    taskId: string,
    result: Result
  ): Promise<void> {
    this.cancelledResults.set(taskId, result);
    await this.scheduleCancelledTaskCleanup(taskId);
  }

  async getTaskResult(
    ...args: Parameters<TaskStore['getTaskResult']>
  ): ReturnType<TaskStore['getTaskResult']> {
    const cancelledResult = this.cancelledResults.get(args[0]);
    if (cancelledResult) {
      return cancelledResult;
    }

    try {
      return await this.base.getTaskResult(...args);
    } catch (error: unknown) {
      const task = await this.base.getTask(args[0], args[1]);
      if (task?.status === 'cancelled') {
        return createErrorToolResponse(
          'E_TASK_CANCELLED',
          task.statusMessage ?? 'Task cancelled',
          undefined,
          { retryable: false, kind: 'cancelled' }
        );
      }

      throw error;
    }
  }

  async updateTaskStatus(
    ...args: Parameters<TaskStore['updateTaskStatus']>
  ): ReturnType<TaskStore['updateTaskStatus']> {
    const taskId = args[0];
    const status = args[1];

    if (status !== 'cancelled') {
      this.clearCancelledTaskResult(taskId);
    } else {
      const controller = this.abortControllers.get(taskId);
      if (controller) {
        controller.abort(new DOMException('Task cancelled', 'AbortError'));
      }
    }

    await this.base.updateTaskStatus(...args);
  }

  async listTasks(
    ...args: Parameters<TaskStore['listTasks']>
  ): ReturnType<TaskStore['listTasks']> {
    return await this.base.listTasks(...args);
  }

  cleanup(): void {
    for (const timer of this.cancelledResultTimers.values()) {
      clearTimeout(timer);
    }

    this.cancelledResultTimers.clear();
    this.cancelledResults.clear();

    for (const controller of this.abortControllers.values()) {
      controller.abort(new DOMException('Store cleanup', 'AbortError'));
    }
    this.abortControllers.clear();

    if (hasCleanup(this.base)) {
      this.base.cleanup();
    }
  }
}
