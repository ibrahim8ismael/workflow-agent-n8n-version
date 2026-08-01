import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Job, Queue, Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: Redis;
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  constructor() {
    this.connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.connection.on('error', (err) => {
      this.logger.error(`Queue Redis connection error: ${err.message}`);
    });
  }

  getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, { connection: this.connection });
      this.queues.set(name, queue);
    }
    return this.queues.get(name)!;
  }

  createWorker(
    name: string,
    processor: (job: Job) => Promise<unknown>,
    opts?: Partial<WorkerOptions>,
  ): Worker {
    if (this.workers.has(name)) {
      return this.workers.get(name)!;
    }
    const worker = new Worker(name, processor, {
      connection: this.connection,
      concurrency: 5,
      ...opts,
    });
    this.workers.set(name, worker);
    return worker;
  }

  async addJob(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    opts?: { delay?: number; priority?: number; attempts?: number },
  ): Promise<Job> {
    const queue = this.getQueue(queueName);
    return queue.add(jobName, data, {
      attempts: opts?.attempts ?? 3,
      backoff: { type: 'exponential', delay: 2000 },
      delay: opts?.delay,
      priority: opts?.priority,
    });
  }

  async onModuleDestroy() {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    await this.connection.quit();
  }
}
