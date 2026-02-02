type Task<T> = () => Promise<T>;

export class MessageQueue {
  private queue: Task<void>[] = [];
  private processing = false;
  private delayMs: number;

  constructor(delayMs = 1000) {
    this.delayMs = delayMs;
  }

  enqueue(task: Task<void>) {
    this.queue.push(task);
    this.process();
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error("[Queue] Task failed:", err);
        }
        // Add artificial delay to mimic human behavior and prevent rate limits
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    this.processing = false;
  }
}
