import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAdapterService } from '../../../infrastructure/ai-adapter/ai-adapter.service';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { Plan, PlanStep } from '../../planner/interfaces/plan.interface';
import { PlannerService } from '../../planner/planner.service';
import { RunsService } from '../../runs/runs.service';
import { SKILL_EXECUTION_MODE } from '../../skills/constants/skill.constants';
import { SkillsService } from '../../skills/services/skills.service';
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
    transitionStatus: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    updateUsage: vi.fn(),
  } as unknown as RunsService;

  const mockAgentsService = {
    findById: vi.fn(),
    getSkills: vi.fn(),
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

  const mockSkillsService = {
    findById: vi.fn(),
  } as unknown as SkillsService;

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
    goal: 'Summarize revenue',
    reasoning: 'Use knowledge',
    steps: [step],
    missingInputs: [],
    successCriteria: ['answer'],
    estimatedComplexity: 'simple',
    requiresApproval: false,
    agentId: 'agent-1',
    conversationId: 'conv-1',
  };

  const skill = {
    id: 'as-1',
    skillId: 'skill-1',
    name: 'Search Knowledge',
    slug: 'search-knowledge',
    description: 'Searches the knowledge base',
    executionMode: SKILL_EXECUTION_MODE.AI_ONLY,
    instructions: 'Search and summarize.',
    timeout: 60_000,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRunsService.create).mockResolvedValue(
      run({ status: 'CREATED', result: null }) as never,
    );
    vi.mocked(mockRunsService.transitionStatus).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.complete).mockResolvedValue(run() as never);
    vi.mocked(mockRunsService.fail).mockResolvedValue(run({ status: 'FAILED' }) as never);
    vi.mocked(mockRunsService.updateUsage).mockResolvedValue(run() as never);
    vi.mocked(mockAgentsService.findById).mockResolvedValue({
      id: 'agent-1',
      instructions: 'Be an AI employee.',
    } as never);
    vi.mocked(mockAgentsService.getSkills).mockResolvedValue([
      { id: 'as-1', skillId: 'skill-1', enabled: true },
    ] as never);
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
    vi.mocked(mockSkillsService.findById).mockResolvedValue({
      id: 'skill-1',
      name: 'Search Knowledge',
      slug: 'search-knowledge',
      executionMode: SKILL_EXECUTION_MODE.AI_ONLY,
      instructions: 'Search and summarize.',
      timeout: 60_000,
    } as never);
    vi.mocked(mockKnowledgeService.search).mockResolvedValue([{ content: 'chunk-1' }] as never);
    vi.mocked(mockConfigService.get).mockReturnValue('https://n8n.example.com/webhook');

    service = new RuntimeService(
      mockRunsService,
      mockAgentsService,
      mockPlannerService,
      mockAiAdapter,
      mockContextBuilder,
      mockConversationsService,
      mockMemoryService,
      mockSkillsService,
      mockKnowledgeService,
      mockConfigService,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('execute (happy path)', () => {
    beforeEach(() => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
    });

    it('should create a run and transition through statuses', async () => {
      await service.execute(request);

      expect(mockRunsService.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(1, 'run-1', 'PREPARING');
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(2, 'run-1', 'PLANNING');
      expect(mockRunsService.transitionStatus).toHaveBeenNthCalledWith(3, 'run-1', 'EXECUTING');
    });

    it('should load skills, build context and generate text', async () => {
      await service.execute(request);

      expect(mockAgentsService.findById).toHaveBeenCalledWith('agent-1', true);
      expect(mockSkillsService.findById).toHaveBeenCalledWith('skill-1');
      expect(mockContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', userMessage: 'Summarize Q2 revenue' }),
      );
      expect(mockAiAdapter.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          temperature: 0.7,
          maxTokens: 2000,
          sdkTools: expect.any(Object),
        }),
      );
    });

    it('should use the agent model when configured', async () => {
      vi.mocked(mockAgentsService.findById).mockResolvedValue({
        id: 'agent-1',
        instructions: 'Be an AI employee.',
        model: 'openai:gpt-4o-mini',
      } as never);

      await service.execute(request);

      expect(mockAiAdapter.generateText).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai:gpt-4o-mini' }),
      );
    });

    it('should persist usage, messages and memory', async () => {
      await service.execute(request);

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
      const result = await service.execute(request);

      expect(mockRunsService.complete).toHaveBeenCalledWith('run-1', 'answer');
      expect(result).toEqual({
        runId: 'run-1',
        response: 'answer',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });
    });

    it('should skip conversation persistence when no conversationId', async () => {
      await service.execute({ ...request, conversationId: undefined });

      expect(mockConversationsService.addMessage).not.toHaveBeenCalled();
    });

    it('should not fail the run when memory upsert fails', async () => {
      vi.mocked(mockMemoryService.upsert).mockRejectedValue(new Error('memory down'));

      const result = await service.execute(request);

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
      expect(result).toEqual({
        runId: 'run-1',
        response: 'Invalid plan: Plan must have a goal',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
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
      expect(mockRunsService.complete).toHaveBeenCalledWith(
        'run-1',
        'I need more information:\n- Please provide a date range',
      );
      expect(result.response).toContain('I need more information');
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
      expect(result.response).toContain('An error occurred');
    });

    it('should fail the run when the AI call throws', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
      vi.mocked(mockAiAdapter.generateText).mockRejectedValue(new Error('provider down'));

      const result = await service.execute(request);

      expect(mockRunsService.fail).toHaveBeenCalledWith('run-1', 'provider down');
      expect(result.response).toContain('provider down');
    });

    it('should filter out disabled skills', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
      vi.mocked(mockAgentsService.getSkills).mockResolvedValue([
        { id: 'as-1', skillId: 'skill-1', enabled: false },
      ] as never);

      await service.execute(request);

      expect(mockSkillsService.findById).not.toHaveBeenCalled();
    });

    it('should drop skills that cannot be resolved', async () => {
      vi.mocked(mockPlannerService.createPlan).mockResolvedValue(plan as never);
      vi.mocked(mockSkillsService.findById).mockRejectedValue(new NotFoundException('no'));

      await service.execute(request);

      expect(mockSkillsService.findById).toHaveBeenCalledWith('skill-1');
      expect(mockRunsService.fail).not.toHaveBeenCalled();
      expect(mockAiAdapter.generateText).toHaveBeenCalled();
    });
  });

  describe('executeSkill', () => {
    it('should throw when the skill is not available', async () => {
      await expect(
        (service as any).executeSkill(step, undefined, {}, 'gpt-4o', request),
      ).rejects.toThrow('Skill "search" is not available for this agent');
    });

    it('should run KNOWLEDGE_RETRIEVAL mode', async () => {
      await (service as any).executeSkill(
        step,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL },
        { query: 'revenue', limit: '3' },
        'gpt-4o',
        request,
      );

      expect(mockKnowledgeService.search).toHaveBeenCalledWith({
        organizationId: 'org-1',
        query: 'revenue',
        limit: 3,
        offset: 0,
      });
    });

    it('should run MEMORY_RETRIEVAL mode', async () => {
      await (service as any).executeSkill(
        step,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.MEMORY_RETRIEVAL },
        { query: 'last topic' },
        'gpt-4o',
        request,
      );

      expect(mockMemoryService.searchByAgent).toHaveBeenCalledWith('agent-1', 'last topic', {
        limit: 10,
      });
    });

    it('should reject HUMAN_APPROVAL mode', async () => {
      await expect(
        (service as any).executeSkill(
          step,
          { ...skill, executionMode: SKILL_EXECUTION_MODE.HUMAN_APPROVAL },
          {},
          'gpt-4o',
          request,
        ),
      ).rejects.toThrow('requires human approval');
    });

    it('should run AI_ONLY mode with skill instructions', async () => {
      const result = await (service as any).executeSkill(
        step,
        skill,
        { query: 'x' },
        'gpt-4o',
        request,
      );

      expect(mockAiAdapter.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          systemPrompt: 'Search and summarize.',
          temperature: 0.3,
          maxTokens: 1500,
        }),
      );
      expect(result).toBe('answer');
    });

    it('should augment HYBRID mode with knowledge context', async () => {
      await (service as any).executeSkill(
        step,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.HYBRID },
        { query: 'revenue' },
        'gpt-4o',
        request,
      );

      expect(mockKnowledgeService.search).toHaveBeenCalled();
      const params = vi.mocked(mockAiAdapter.generateText).mock.calls[0][0];
      expect(params.systemPrompt).toContain('Relevant knowledge:');
      expect(params.systemPrompt).toContain('chunk-1');
    });

    it('should fall back to the user message when no query is resolvable', async () => {
      await (service as any).executeSkill(
        step,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL },
        {},
        'gpt-4o',
        request,
      );

      expect(mockKnowledgeService.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Summarize Q2 revenue' }),
      );
    });

    it('should prefer args.query over step input', async () => {
      const stepWithInput = { ...step, input: { query: 'from-plan' } };
      await (service as any).executeSkill(
        stepWithInput,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL },
        { query: 'from-args' },
        'gpt-4o',
        request,
      );

      expect(mockKnowledgeService.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'from-args' }),
      );
    });

    it('should use the plan input query when args have none', async () => {
      const stepWithInput = { ...step, input: { query: 'from-plan' } };
      await (service as any).executeSkill(
        stepWithInput,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL },
        {},
        'gpt-4o',
        request,
      );

      expect(mockKnowledgeService.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'from-plan' }),
      );
    });

    it('should time out slow skills', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(mockKnowledgeService.search).mockReturnValue(new Promise(() => {}) as never);
        const promise = (service as any).executeSkill(
          step,
          { ...skill, executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL, timeout: 50 },
          { query: 'slow' },
          'gpt-4o',
          request,
        );
        const expectation = expect(promise).rejects.toThrow('timed out after 50ms');
        await vi.advanceTimersByTimeAsync(100);
        await expectation;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('executeSkill — N8N workflow', () => {
    const n8nSkill = {
      ...skill,
      executionMode: SKILL_EXECUTION_MODE.N8N_WORKFLOW,
      slug: 'search-knowledge',
    };

    it('should post to the n8n webhook and return the JSON body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: vi.fn().mockResolvedValue({ result: 'from-n8n' } as never),
        text: vi.fn(),
      } as never);
      vi.stubGlobal('fetch', fetchMock);

      const result = await (service as any).executeSkill(
        step,
        n8nSkill,
        { query: 'x' },
        'gpt-4o',
        request,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://n8n.example.com/webhook/search-knowledge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: 'x', userId: 'user-1', organizationId: 'org-1' }),
        }),
      );
      expect(result).toEqual({ result: 'from-n8n' });
    });

    it('should return text body for non-JSON responses', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('plain response' as never),
      } as never);
      vi.stubGlobal('fetch', fetchMock);

      const result = await (service as any).executeSkill(step, n8nSkill, {}, 'gpt-4o', request);

      expect(result).toBe('plain response');
    });

    it('should throw when N8N_WEBHOOK_URL is not configured', async () => {
      vi.mocked(mockConfigService.get).mockReturnValue(undefined);

      await expect(
        (service as any).executeSkill(step, n8nSkill, {}, 'gpt-4o', request),
      ).rejects.toThrow('N8N_WEBHOOK_URL is not configured');
    });

    it('should not retry on client errors (4xx)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => '' },
        json: vi.fn(),
        text: vi.fn(),
      } as never);
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        (service as any).executeSkill(step, n8nSkill, {}, 'gpt-4o', request),
      ).rejects.toThrow('n8n workflow returned HTTP 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should retry server errors per the retry policy', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => '' },
        json: vi.fn(),
        text: vi.fn(),
      } as never);
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        (service as any).executeSkill(
          step,
          { ...n8nSkill, retryPolicy: { maxAttempts: 3 } },
          {},
          'gpt-4o',
          request,
        ),
      ).rejects.toThrow('n8n workflow returned HTTP 500');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
