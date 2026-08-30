/**
 * A bounded queue for transactional email.
 *
 * Signup bursts wait for a worker rather than being rejected because all
 * outbound email slots are busy. Temporary provider errors are retried with
 * exponential backoff.
 */
class EmailQueue {
  constructor(options = {}) {
    this.name = options.name || 'TransactionalEmail';
    this.concurrency = Math.max(1, Number(options.concurrency) || 5);
    this.maxPending = Math.max(this.concurrency, Number(options.maxPending) || 500);
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
    this.baseRetryMs = Math.max(0, Number(options.baseRetryMs) || 1000);
    this.queue = [];
    this.activeCount = 0;
  }

  enqueue(task) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Email queue task must be a function'));
    }
    if (this.queue.length >= this.maxPending) {
      return Promise.reject(new Error(`${this.name} queue is temporarily full. Please try again shortly.`));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      this.activeCount++;
      this.run(item)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.activeCount--;
          this.drain();
        });
    }
  }

  async run(item) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await item.task();
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts || !EmailQueue.isRetriable(error)) break;

        const exponentialDelay = this.baseRetryMs * (2 ** (attempt - 1));
        const retryAfterMs = Number(error.retryAfterMs) || 0;
        await EmailQueue.wait(Math.max(exponentialDelay, retryAfterMs));
      }
    }
    throw lastError;
  }

  getStatus() {
    return {
      name: this.name,
      activeCount: this.activeCount,
      pendingCount: this.queue.length,
      concurrency: this.concurrency
    };
  }

  static isRetriable(error) {
    const status = Number(error?.status);
    if (status === 429 || status >= 500 || error?.name === 'AbortError') return true;
    return !status;
  }

  static wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = EmailQueue;
