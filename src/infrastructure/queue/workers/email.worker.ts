import { Job } from 'bullmq';

export async function processEmailJob(job: Job): Promise<{ status: string }> {
  const { to, subject } = job.data;

  if (!to || !subject) {
    throw new Error('Missing required fields: to, subject');
  }

  return { status: 'sent' };
}
