import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAdapterService } from '../../../infrastructure/ai-adapter/ai-adapter.service';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { Plan, PlanStep } from '../../planner/interfaces/plan.interface';
import { PlannerService } from '../../planner/planner.service';
import { RunsService } from '../../runs/runs.service';
import { ContextBuilderService } from './context-builder.service';
import { ExecuteRequest, RuntimeService } from './runtime.service';

describe('RuntimeService', () => {
  let service: RuntimeService;

  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    agentId: 'agent-1',
    status: 'COMPLETED',
    result: 'answer',
    error: null,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const mockRunsService = {
    create: vi.fn(),
    findById: vi.fn(),
    transitionStatus: vi.fn(),
    savePlan: vi.fn(),
    updateMetadata: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    updateUsage: vi.fn(),
  } as unknown as RunsService;

  const mockAgentsService = {
    findById: vi.fn(),
  } as unknown as AgentsService;

  const mockPlannerService = {
    createPlan: vi.fn(),
    validatePlan: vi.fn(),
  } as unknown as PlannerService;

  const mockAiAdapter = {
    generateText: vi.fn(),
  } as unknown as AIAdapterService;

  const mockContextBuilder = {
    build: vi.fn(),
  } as unknown as ContextBuilderService;

  const mockConversationsService = {
    getMessages: vi.fn(),
    addMessage: vi.fn(),
  } as unknown as ConversationsService;

  const mockMemoryService = {
    upsert: vi.fn(),
    searchByAgent: vi.fn(),
  } as unknown as MemoryService;

  const mockKnowledgeService = {
    search: vi.fn(),
  } as unknown as KnowledgeService;

  const mockConfigService = {
    get: vi.fn(),
  } as unknown as ConfigService;

  const request: ExecuteRequest = {
    userMessage: 'Summarize Q2 revenue',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    organizationId: 'org-1',
  };

  const step: PlanStep = {
    skillId: 'skill-1',
    skillName: 'search',
    order: 1,
    input: {},
    required: true,
  };

  const plan: Plan = {
    intent: 'task_execution',
    goal: 'Summarize revenue',
    reasoning: 'Use knowledge',
    steps: [step],
    missingInputs: [],
    successCriteria: ['answer'],
    estimatedComplexity: 'simple',
    requiresApproval: false,
    approvalReasons: [],
    unavailableCapabilities: [],
    confidence: 0.95,
    agentId: 'agent-1',
    conversationId: 'conv-1',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRunsService.create).mockResolvedValue(
      run({ status: 'CREATED', result: null }) as never,
    );
    vi.mocked(mockRunsService.findById).mockImplementation(
      async () =>
        run({
          status: 'WAITING',
          plan,
          metadata: { userMessage: request.userMessage, organizationId: request.organizationId },
          conversationId: request.conversationId,
        }) as never,
    );
    vi.mocked(mockRunsService.transitionStatus).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.savePlan).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.updateMetadata).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.complete).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.fail).mockResolvedValue(run({ status: 'FAILED' }) as never);
    vi.mocked(mockRunsService.cancel).mockResolvedValue(run({ status: 'CANCELLED' }) as never);
    vi.mocked(mockRunsService.updateUsage).mockResolvedValue(run() as never);
    vi.mocked(mockAgentsService.findById).mockResolvedValue({
      id: 'agent-1',
      instructions: 'Be an AI employee.',
    } as never);
    vi.mocked(mockPlannerService.validatePlan).mockResolvedValue({
      valid: true,
      errors: [],
    } as never);
    vi.mocked(mockAiAdapter.generateText).mockResolvedValue({
      content: 'answer',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    } as never);
    vi.mocked(mockContextBuilder.build).mockResolvedValue({
      system: 'system prompt',
      messages: [{ role: 'user', content: 'Hi' }],
      metadata: { memoryCount: 0, knowledgeCount: 0, totalTokens: 10 },
    } as never);
    vi.mocked(mockConversationsService.getMessages).mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Hello' },
    ] as never);
    vi.mocked(mockConversationsService.addMessage).mockResolvedValue(undefined as never);
    vi.mocked(mockMemoryService.upsert).mockResolvedValue(undefined as never);
    vi.mocked(mockMemoryService.searchByAgent).mockResolvedValue([
      { key: 'm1', content: 'memory' },
    ] as never);
    vi.mocked(mockKnowledgeService.search).mockResolvedValue([{ content: 'chunk-1' }] as never);
    vi.mocked(mockConfigService.get).mockReturnValue('https://n8n.example.com/webhook');

    service = new RuntimeService(
      mockRunsService,
      mockAgentsService,
      mockPlannerService,
      mockAiAdapter as unknown as LLMRuntimeService,
      mockContextBuilder,
      mockConversationsService,
      mockMemoryService,
      mockKnowledgeService,
      mockConfigService,
      { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('execute (happy path)', () => {
    beforeEach(() => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
    });

    it('should use conversation mode for brainstorming without planning tools', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue({
        ...plan,
        intent: 'brainstorming',
        steps: [],
      } as never);

      const result = await service.execute({
        ...request,
        userMessage: 'Help me brainstorm an email workflow.',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.response).toBe('answer');
      expect(mockPlannerService.validatePlan).not.toHaveBeenCalled();
      expect(mockAiAdapter.generateText).toHaveBeenCalledWith(
        expect.not.objectContaining({ sdkTools: expect.anything() }),
      );
      expect(mockConversationsService.addMessage).toHaveBeenCalledTimes(2);
      expect(mockMemoryService.upsert).not.toHaveBeenCalled();
    });

    it('does not retrieve knowledge for the MVP planner path', async () => {
      await service.execute(request);

      expect(mockKnowledgeService.search).not.toHaveBeenCalled();
      expect(mockPlannerService.createPlan).toHaveBeenCalledWith(
        expect.not.objectContaining({ knowledge: expect.anything() }),
      );
    });

    it('should create a run and transition through statuses', async () => {
      await service.execute(request);
      await service.approve('run-1');

      expect(mockRunsService.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(1, 'run-1', 'PREPARING');
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(2, 'run-1', 'PLANNING');
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(3, 'run-1', 'WAITING');
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(4, 'run-1', 'EXECUTING');
    });

    it('should build context and generate text', async () => {
      await service.execute(request);
      await service.approve('run-1');

      expect(mockAgentsService.findById).toHaveBeenCalledWith('agent-1', true, {
        organizationId: 'org-1',
        userId: undefined,
      });
      expect(mockContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', userMessage: 'Summarize Q2 revenue' }),
      );
      expect(mockAiAdapter.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'medium',
          temperature: 0.7,
          maxTokens: 2000,
          sdkTools: expect.any(Object),
        }),
      );
    });

    it('should persist usage, messages and memory', async () => {
      await service.execute(request);
      await service.approve('run-1');

      expect(mockRunsService.updateUsage).toHaveBeenCalledWith('run-1', {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(mockConversationsService.addMessage).toHaveBeenCalledTimes(2);
      expect(mockMemoryService.upsert).toHaveBeenCalledWith(
        'agent-1',
        'last-conversation-conv-1',
        'CONVERSATION',
        expect.stringContaining('Summarize Q2 revenue'),
      );
    });

    it('should complete the run and return the response with usage', async () => {
      await service.execute(request);
      const result = await service.approve('run-1');

      expect(mockRunsService.complete).toHaveBeenCalledWith('run-1', 'answer');
      expect(result.response).toBe('answer');
      expect(result.status).toBe('COMPLETED');
    });

    it('should skip conversation persistence when no conversationId', async () => {
      await service.execute({ ...request, conversationId: undefined });

      expect(mockConversationsService.addMessage).not.toHaveBeenCalled();
    });

    it('should not fail the run when memory upsert fails', async () => {
      vi.mocked(mockMemoryService.upsert).mockRejectedValue(new Error('memory down'));

      await service.execute(request);
      const result = await service.approve('run-1');

      expect(result.response).toBe('answer');
      expect(mockRunsService.fail).not.toHaveBeenCalled();
    });
  });

  describe('execute (error paths)', () => {
    it('should fail the run when the plan is invalid', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
      vi.mocked(mockPlannerService.validatePlan).mockResolvedValue({
        valid: false,
        errors: ['Plan must have a goal'],
      } as never);

      const result = await service.execute(request);

      expect(mockRunsService.fail).toHaveBeenCalledWith(
        'run-1',
        'Invalid plan: Plan must have a goal',
      );
      expect(result.response).toBe('Invalid plan: Plan must have a goal');
    });

    it('should ask for missing inputs instead of executing', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue({
        ...plan,
        steps: [],
        missingInputs: [
          { field: 'date', description: 'Please provide a date range', skillId: 'skill-1' },
        ],
      } as never);

      const result = await service.execute(request);

      expect(mockRunsService.transitionStatus).not.toHaveBeenCalledWith('run-1', 'EXECUTING');
      expect(mockRunsService.transitionStatus).toHaveBeenCalledWith('run-1', 'WAITING');
      expect(mockRunsService.complete).not.toHaveBeenCalled();
      expect(result.response).toContain('Please provide a date range');
    });

    it('should fail the run when the agent is not found', async () => {
      vi.mocked(mockAgentsService.findById).mockRejectedValue(
        new NotFoundException('Agent with id "agent-1" not found'),
      );

      const result = await service.execute(request);

      expect(mockRunsService.fail).toHaveBeenCalledWith(
        'run-1',
        'Agent with id "agent-1" not found',
      );
      expect(result.response).toBe('The requested business record could not be found.');
    });

    it('should fail the run when the AI call throws', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
      vi.mocked(mockAiAdapter.generateText).mockRejectedValue(new Error('provider down'));

      await service.execute(request);
      const result = await service.approve('run-1');

      expect(mockRunsService.fail).toHaveBeenCalledWith('run-1', 'provider down');
      expect(result.response).toBe(
        'I could not complete this action. No successful result was confirmed.',
      );
    });

    it('should reject a waiting plan without executing it', async () => {
      await service.execute(request);

      const result = await service.reject('run-1', 'Needs correction');

      expect(mockRunsService.cancel).toHaveBeenCalledWith('run-1');
      expect(result.status).toBe('CANCELLED');
      expect(mockAiAdapter.generateText).not.toHaveBeenCalled();
    });
  });
});
