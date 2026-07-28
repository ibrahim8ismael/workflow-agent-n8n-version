import { Job } from 'bullmq';

export async function processIndexingJob(job: Job): Promise<{ status: string }> {
  const { documentId, content } = job.data;

  if (!documentId || !content) {
    throw new Error('Missing required fields: documentId, content');
  }

  return { status: 'indexed' };
}
