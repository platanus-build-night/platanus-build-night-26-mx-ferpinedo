type GenerationJob = () => Promise<void>;

export type GenerationQueueResult =
  | { status: "running" }
  | { status: "queued"; position: number }
  | { status: "queue_full" }
  | { status: "rate_limited" };

interface QueuedGenerationJob {
  userId: string;
  job: GenerationJob;
}

interface GenerationQueueOptions {
  maxConcurrent: number;
  maxQueued: number;
  perContactLimit: number;
  perContactWindowMs: number;
}

export class GenerationQueue {
  private activeCount = 0;
  private readonly queue: QueuedGenerationJob[] = [];
  private readonly contactAcceptedAt = new Map<string, number[]>();

  constructor(
    private readonly options: GenerationQueueOptions = {
      maxConcurrent: 3,
      maxQueued: 10,
      perContactLimit: 2,
      perContactWindowMs: 10 * 60 * 1000
    }
  ) {}

  enqueue(userId: string, job: GenerationJob): GenerationQueueResult {
    if (!this.canAcceptForContact(userId)) {
      return { status: "rate_limited" };
    }

    if (this.activeCount < this.options.maxConcurrent) {
      this.recordAccepted(userId);
      this.run(userId, job);
      return { status: "running" };
    }

    if (this.queue.length >= this.options.maxQueued) {
      return { status: "queue_full" };
    }

    this.recordAccepted(userId);
    this.queue.push({ userId, job });
    return { status: "queued", position: this.queue.length };
  }

  stats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.options.maxConcurrent,
      maxQueued: this.options.maxQueued
    };
  }

  private canAcceptForContact(userId: string): boolean {
    const now = Date.now();
    const recent = (this.contactAcceptedAt.get(userId) ?? []).filter((timestamp) => now - timestamp < this.options.perContactWindowMs);
    this.contactAcceptedAt.set(userId, recent);
    return recent.length < this.options.perContactLimit;
  }

  private recordAccepted(userId: string): void {
    const recent = this.contactAcceptedAt.get(userId) ?? [];
    recent.push(Date.now());
    this.contactAcceptedAt.set(userId, recent);
  }

  private run(userId: string, job: GenerationJob): void {
    this.activeCount += 1;
    console.log(`[queue] started generation user=${userId} active=${this.activeCount} queued=${this.queue.length}`);

    void job()
      .catch((error) => {
        console.error(`[queue] generation failed user=${userId}`, error);
      })
      .finally(() => {
        this.activeCount -= 1;
        console.log(`[queue] completed generation user=${userId} active=${this.activeCount} queued=${this.queue.length}`);
        this.startNext();
      });
  }

  private startNext(): void {
    while (this.activeCount < this.options.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }

      this.run(next.userId, next.job);
    }
  }
}
