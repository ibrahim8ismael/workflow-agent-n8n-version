import { Job } from 'bullmq';

export async function processNotificationJob(job: Job): Promise<{ status: string }> {
  const { userId, type, title } = job.data;

  if (!userId || !type || !title) {
    throw new Error('Missing required fields: userId, type, title');
  }

  return { status: 'dispatched' };
}
