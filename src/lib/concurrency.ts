export class ConcurrencyLimiter {
  private activeCount = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly maxConcurrent: () => number,
    private readonly waitTimeoutMs: () => number,
    private readonly formatTimeoutError: (
      limit: number,
      timeoutMs: number
    ) => string,
    private readonly formatCancelError: () => string
  ) {}

  get pendingCount(): number {
    return this.waiters.size;
  }

  get active(): number {
    return this.activeCount;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    const limit = this.maxConcurrent();
    if (this.activeCount < limit) {
      this.activeCount++;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;

      const waiter = (): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        this.activeCount++;
        resolve();
      };

      const onAbort = (): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        clearTimeout(timeoutId);
        this.waiters.delete(waiter);
        reject(new Error(this.formatCancelError()));
      };

      const onTimeout = (): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        signal?.removeEventListener('abort', onAbort);
        this.waiters.delete(waiter);
        reject(new Error(this.formatTimeoutError(limit, this.waitTimeoutMs())));
      };

      if (signal) {
        if (signal.aborted) {
          reject(new Error(this.formatCancelError()));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeoutId = setTimeout(onTimeout, this.waitTimeoutMs());
      this.waiters.add(waiter);
    });
  }

  release(): void {
    if (this.activeCount > 0) {
      this.activeCount--;
      const next = this.waiters.values().next().value;
      if (next) {
        this.waiters.delete(next);
        next();
      }
    }
  }
}
