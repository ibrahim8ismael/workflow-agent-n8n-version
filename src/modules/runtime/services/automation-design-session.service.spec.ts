import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import { AutomationDesignSessionService } from './automation-design-session.service';

describe('AutomationDesignSessionService', () => {
  let conversations: {
    findByIdInScope: ReturnType<typeof vi.fn>;
    updateMetadata: ReturnType<typeof vi.fn>;
  };
  let runs: {
    findById: ReturnType<typeof vi.fn>;
    updateMetadata: ReturnType<typeof vi.fn>;
  };
  let service: AutomationDesignSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    conversations = {
      findByIdInScope: vi.fn().mockResolvedValue({ metadata: null }),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    } as never;
    runs = {
      findById: vi.fn().mockResolvedValue({ metadata: null }),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    } as never;
    service = new AutomationDesignSessionService(
      conversations as unknown as ConversationsService,
      runs as unknown as RunsService,
    );
  });

  it('loads an empty session when no metadata exists', async () => {
    const session = await service.load({ conversationId: 'conv-1', userId: 'user-1' });

    expect(session).toMatchObject({
      status: 'GATHERING_REQUIREMENTS',
      approvalStatus: 'NOT_READY',
      missingRequirements: [],
    });
  });

  it('normalizes a stored session from conversation metadata', async () => {
    conversations.findByIdInScope = vi.fn().mockResolvedValue({
      metadata: {
        automationDesign: {
          status: 'READY_FOR_REVIEW',
          approvalStatus: 'READY',
          blueprintRevision: 'rev-1',
          missingRequirements: ['Which ledger?', 42],
        },
      },
    });

    const session = await service.load({ conversationId: 'conv-1', userId: 'user-1' });

    expect(session.status).toBe('READY_FOR_REVIEW');
    expect(session.blueprintRevision).toBe('rev-1');
    expect(session.missingRequirements).toEqual(['Which ledger?']);
  });

  it('persists the session onto both run and conversation metadata', async () => {
    const session = {
      status: 'READY_FOR_REVIEW' as const,
      approvalStatus: 'READY' as const,
      missingRequirements: [],
      blueprintRevision: 'rev-1',
    };

    await service.persist({ runId: 'run-1', conversationId: 'conv-1', session });

    expect(runs.updateMetadata).toHaveBeenCalledWith('run-1', { automationDesign: session });
    expect(conversations.updateMetadata).toHaveBeenCalledWith('conv-1', {
      automationDesign: session,
    });
  });
});
