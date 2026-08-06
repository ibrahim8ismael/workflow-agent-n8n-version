import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAdapterService } from '../../infrastructure/ai-adapter/ai-adapter.service';
import { LLMRuntimeService } from '../../infrastructure/llm-runtime/llm-runtime.service';
import { Plan } from './interfaces/plan.interface';
import { PlannerService } from './planner.service';

describe('PlannerService', () => {
  let service: PlannerService;

  const mockAiAdapter = {
    generateObject: vi.fn(),
  } as unknown as AIAdapterService;

  const validPlan: Plan = {
    intent: 'task_execution',
    goal: 'Answer the question',
    reasoning: 'Use knowledge skill',
    steps: [
      {
        skillId: 'skill-1',
        skillName: 'Search Knowledge',
        order: 1,
        input: { query: 'revenue' },
        required: true,
      },
    ],
    missingInputs: [],
    successCriteria: ['answer given'],
    estimatedComplexity: 'simple',
    requiresApproval: false,
    approvalReasons: [],
    unavailableCapabilities: [],
    confidence: 0.95,
    agentId: 'agent-1',
  };

  const plannerInput = {
    userMessage: 'Summarize Q2 revenue',
    agentId: 'agent-1',
    agentInstructions: 'Be concise.',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    availableSkills: [
      {
        id: 'agent-skill-1',
        skillId: 'skill-1',
        name: 'Search Knowledge',
        description: 'Searches the knowledge base',
        executionMode: 'KNOWLEDGE_RETRIEVAL',
      },
    ],
    memory: [{ key: 'last-topic', content: 'Q2 revenue', type: 'CONVERSATION' }],
    knowledge: ['Revenue grew 20%'],
    conversationHistory: [{ role: 'user', content: 'Hi' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlannerService(mockAiAdapter as unknown as LLMRuntimeService);
  });

  describe('createPlan', () => {
    it('should return the plan enriched with agentId and conversationId', async () => {
      vi.mocked(mockAiAdapter.generateObject).mockResolvedValue({
        object: validPlan,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      const result = await service.createPlan(plannerInput);

      expect(result).toMatchObject({
        goal: validPlan.goal,
        agentId: 'agent-1',
        conversationId: 'conv-1',
      });
    });

    it('should call generateObject with the plan schema', async () => {
      vi.mocked(mockAiAdapter.generateObject).mockResolvedValue({
        object: validPlan,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      await service.createPlan(plannerInput);

      expect(mockAiAdapter.generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'high',
          temperature: 0.2,
          maxTokens: 2000,
          schema: expect.any(Object),
        }),
      );
    });

    it('should include skills, memory and agent instructions in prompts', async () => {
      vi.mocked(mockAiAdapter.generateObject).mockResolvedValue({
        object: validPlan,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      await service.createPlan(plannerInput);

      const params = vi.mocked(mockAiAdapter.generateObject).mock.calls[0][0];
      expect(params.systemPrompt).toContain('Search Knowledge (skill-1)');
      expect(params.systemPrompt).toContain('[Mode: KNOWLEDGE_RETRIEVAL]');
      expect(params.systemPrompt).toContain('last-topic: Q2 revenue');
      expect(params.systemPrompt).toContain('<employee_policies>\nBe concise.');
      expect(params.messages[0].content).toContain('Summarize Q2 revenue');
      expect(params.messages[0].content).toContain('Revenue grew 20%');
      expect(params.messages[0].content).toContain('user: Hi');
    });

    it('should use the requested effort level', async () => {
      vi.mocked(mockAiAdapter.generateObject).mockResolvedValue({
        object: validPlan,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      await service.createPlan({ ...plannerInput, effort: 'low' });

      expect(mockAiAdapter.generateObject).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'low' }),
      );
    });

    it('should omit memory and knowledge blocks when empty', async () => {
      vi.mocked(mockAiAdapter.generateObject).mockResolvedValue({
        object: validPlan,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      await service.createPlan({ ...plannerInput, memory: [], knowledge: [] });

      const params = vi.mocked(mockAiAdapter.generateObject).mock.calls[0][0];
      expect(params.systemPrompt).not.toContain('Relevant Memory:');
      expect(params.messages[0].content).not.toContain('Relevant Knowledge:');
    });
  });

  describe('validatePlan', () => {
    it('should return valid for a well-formed plan', async () => {
      const result = await service.validatePlan(validPlan);

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should reject a plan without a goal', async () => {
      const result = await service.validatePlan({ ...validPlan, goal: '' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan must have a goal');
    });

    it('should reject a plan without steps', async () => {
      const result = await service.validatePlan({ ...validPlan, steps: [] });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan must have at least one step');
    });

    it('should reject steps with missing skillId or skillName', async () => {
      const result = await service.validatePlan({
        ...validPlan,
        steps: [
          { ...validPlan.steps[0], skillId: '', skillName: '' },
          { ...validPlan.steps[0], order: 2, skillName: '' },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Step 1: missing skillId');
      expect(result.errors).toContain('Step 1: missing skillName');
      expect(result.errors).toContain('Step 2: missing skillName');
    });
  });
});
