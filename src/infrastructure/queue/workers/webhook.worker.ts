import type { Job } from 'bullmq';

export async function processWebhookJob(job: Job): Promise<{ status: string }> {
  const { url } = job.data;

  if (!url) {
    throw new Error('Missing required field: url');
  }

  return { status: 'delivered' };
}
