import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../agents/services/agents.service';
import { ConversationsService } from '../conversations/services/conversations.service';
import { PlannerService } from '../planner/planner.service';
import { ConversationRuntimeService } from './conversation/conversation-runtime.service';
import { RuntimeRouterService } from './runtime-router.service';
import { JaafarAutomationDesignGraphService } from './services/jaafar-automation-design-graph.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeMode } from './types/runtime.types';

describe('RuntimeRouterService', () => {
  const conversationRuntime = { run: vi.fn() } as unknown as ConversationRuntimeService;
  const automationDesignGraph = {
    run: vi.fn(),
    resume: vi.fn(),
  } as unknown as JaafarAutomationDesignGraphService;
  const executionRuntime = { execute: vi.fn() } as unknown as RuntimeService;
  const plannerService = { createPlan: vi.fn() } as unknown as PlannerService;
  const agentsService = { findById: vi.fn() } as unknown as AgentsService;
  const conversationsService = { getMessages: vi.fn() } as unknown as ConversationsService;
  const router = new RuntimeRouterService(
    conversationRuntime,
    automationDesignGraph,
    executionRuntime,
    plannerService,
    agentsService,
    conversationsService,
  );
  const request = {
    agentId: 'agent-1',
    userMessage: 'Hello',
    mode: RuntimeMode.CONVERSATION,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentsService.findById).mockResolvedValue({ instructions: '' } as never);
    vi.mocked(conversationsService.getMessages).mockResolvedValue([] as never);
    vi.mocked(plannerService.createPlan).mockResolvedValue({ intent: 'general_question' } as never);
  });

  it('routes conversation requests without invoking execution', async () => {
    vi.mocked(conversationRuntime.run).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run(request);

    expect(conversationRuntime.run).toHaveBeenCalledWith(request);
    expect(executionRuntime.execute).not.toHaveBeenCalled();
  });

  it('routes execution requests to the existing execution runtime', async () => {
    vi.mocked(executionRuntime.execute).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run({ ...request, mode: RuntimeMode.EXECUTION });

    expect(executionRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: RuntimeMode.EXECUTION }),
    );
    expect(conversationRuntime.run).not.toHaveBeenCalled();
  });

  it('routes automation design requests without invoking execution', async () => {
    vi.mocked(automationDesignGraph.run).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run({ ...request, mode: RuntimeMode.AUTOMATION_DESIGN });

    expect(automationDesignGraph.run).toHaveBeenCalled();
    expect(executionRuntime.execute).not.toHaveBeenCalled();
  });

  it('routes planner-detected automation design from default conversation mode', async () => {
    vi.mocked(plannerService.createPlan).mockResolvedValue({
      intent: 'automation_design',
    } as never);
    vi.mocked(automationDesignGraph.run).mockResolvedValue({ runId: 'design-run-1' } as never);

    await router.run(request);

    expect(automationDesignGraph.run).toHaveBeenCalledWith({
      ...request,
      mode: RuntimeMode.AUTOMATION_DESIGN,
    });
    expect(conversationRuntime.run).not.toHaveBeenCalled();
  });

  it('rejects unknown runtime modes', async () => {
    await expect(router.run({ ...request, mode: 'unknown' as RuntimeMode })).rejects.toThrow(
      BadRequestException,
    );
  });
});
