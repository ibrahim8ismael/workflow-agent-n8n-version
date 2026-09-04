import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { automationBlueprintSchema } from '../../automations/schemas/automation-blueprint.schema';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';

export type AutomationBlueprint = z.infer<typeof automationBlueprintSchema>;

export type AutomationDesignStatus = 'GATHERING_REQUIREMENTS' | 'READY_FOR_REVIEW' | 'PROVISIONED';

export type AutomationDesignApprovalStatus = 'NOT_READY' | 'READY' | 'APPROVED' | 'REJECTED';

export interface AutomationDesignSession {
  status: AutomationDesignStatus;
  approvalStatus: AutomationDesignApprovalStatus;
  blueprint?: AutomationBlueprint;
  missingRequirements: string[];
  blueprintRevision?: string;
  automationId?: string;
  connectionId?: string;
  sourceConversationId?: string;
  sourceDesignRunId?: string;
}

const EMPTY_SESSION: AutomationDesignSession = {
  status: 'GATHERING_REQUIREMENTS',
  approvalStatus: 'NOT_READY',
  missingRequirements: [],
};

/**
 * Session state machine for Jaafar automation design.
 * State lives in run/conversation metadata (parity with the previous design
 * session pattern) — only the APPROVED blueprint is promoted into the
 * `automations` table by the AutomationsService.
 */
@Injectable()
export class AutomationDesignSessionService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly runs: RunsService,
  ) {}

  async load(input: {
    conversationId?: string;
    runId?: string;
    userId?: string;
    organizationId?: string;
  }): Promise<AutomationDesignSession> {
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
    session: AutomationDesignSession;
  }): Promise<void> {
    await this.runs.updateMetadata(input.runId, { automationDesign: input.session });
    if (input.conversationId) {
      await this.conversations.updateMetadata(input.conversationId, {
        automationDesign: input.session,
      });
    }
  }

  private readMetadata(metadata: unknown): unknown {
    if (!metadata || typeof metadata !== 'object') return undefined;
    return (metadata as Record<string, unknown>).automationDesign;
  }

  private normalize(value: unknown): AutomationDesignSession {
    if (!value || typeof value !== 'object') return { ...EMPTY_SESSION, missingRequirements: [] };
    const candidate = value as Partial<AutomationDesignSession>;
    return {
      status: candidate.status ?? 'GATHERING_REQUIREMENTS',
      approvalStatus: candidate.approvalStatus ?? 'NOT_READY',
      blueprint: candidate.blueprint,
      missingRequirements: Array.isArray(candidate.missingRequirements)
        ? candidate.missingRequirements.filter((item): item is string => typeof item === 'string')
        : [],
      blueprintRevision: candidate.blueprintRevision,
      automationId: candidate.automationId,
      connectionId: candidate.connectionId,
      sourceConversationId: candidate.sourceConversationId,
      sourceDesignRunId: candidate.sourceDesignRunId,
    };
  }
}
