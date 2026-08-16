import { Injectable } from '@nestjs/common';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import type { EmployeeDesignSession } from '../employee-design/employee-design-session.types';

const EMPTY_SESSION: EmployeeDesignSession = {
  status: 'GATHERING_REQUIREMENTS',
  approvalStatus: 'NOT_READY',
  missingRequirements: [],
};

@Injectable()
export class EmployeeDesignSessionService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly runs: RunsService,
  ) {}

  async load(input: {
    conversationId?: string;
    runId?: string;
    userId?: string;
    organizationId?: string;
  }): Promise<EmployeeDesignSession> {
    if (input.conversationId) {
      const conversation = await this.conversations.findByIdInScope(input.conversationId, {
        userId: input.userId,
        organizationId: input.organizationId,
      });
      return this.normalize(this.readMetadata(conversation.metadata));
    }
    if (input.runId) {
      const run = await this.runs.findById(input.runId);
      return this.normalize(this.readMetadata(run.metadata));
    }
    return { ...EMPTY_SESSION, missingRequirements: [] };
  }

  async persist(input: {
    runId: string;
    conversationId?: string;
    session: EmployeeDesignSession;
  }): Promise<void> {
    await this.runs.updateMetadata(input.runId, { employeeDesign: input.session });
    if (input.conversationId) {
      await this.conversations.updateMetadata(input.conversationId, {
        employeeDesign: input.session,
      });
    }
  }

  private readMetadata(metadata: unknown): unknown {
    if (!metadata || typeof metadata !== 'object') return undefined;
    return (metadata as Record<string, unknown>).employeeDesign;
  }

  private normalize(value: unknown): EmployeeDesignSession {
    if (!value || typeof value !== 'object') return { ...EMPTY_SESSION, missingRequirements: [] };
    const candidate = value as Partial<EmployeeDesignSession>;
    return {
      status: candidate.status ?? 'GATHERING_REQUIREMENTS',
      approvalStatus: candidate.approvalStatus ?? 'NOT_READY',
      blueprint: candidate.blueprint,
      missingRequirements: Array.isArray(candidate.missingRequirements)
        ? candidate.missingRequirements.filter((item): item is string => typeof item === 'string')
        : [],
      blueprintRevision: candidate.blueprintRevision,
      createdEmployeeId: candidate.createdEmployeeId,
      sourceConversationId: candidate.sourceConversationId,
      sourceDesignRunId: candidate.sourceDesignRunId,
    };
  }
}
