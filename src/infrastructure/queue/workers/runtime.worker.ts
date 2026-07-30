import type { Job } from 'bullmq';

export async function processRuntimeJob(job: Job): Promise<{ status: string }> {
  const { action, agentId } = job.data;

  if (!action || !agentId) {
    throw new Error('Missing required fields: action, agentId');
  }

  return { status: 'deployed' };
}
