import { Job } from 'bullmq';

export async function processAiJob(job: Job): Promise<{ status: string }> {
  const { agentId, conversationId } = job.data;

  if (!agentId || !conversationId) {
    throw new Error('Missing required fields: agentId, conversationId');
  }

  return { status: 'processed' };
}
