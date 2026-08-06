import { describe, expect, it, vi } from 'vitest';
import type { PlanStep } from '../../planner/interfaces/plan.interface';
import { SKILL_EXECUTION_MODE } from '../../skills/constants/skill.constants';
import { SkillEmployeeRuntimeService } from './skill-employee-runtime.service';
import { SkillRuntimeError } from './skill-runtime.errors';

describe('SkillEmployeeRuntimeService', () => {
  const step: PlanStep = {
    skillId: 'skill-1',
    skillName: 'Find FAQ',
    order: 1,
    input: {},
    required: true,
  };
  const request = {
    agentId: 'agent-1',
    userMessage: 'Find the refund policy',
    organizationId: 'org-1',
  };
  const skill = {
    id: 'agent-skill-1',
    skillId: 'skill-1',
    name: 'Find FAQ',
    slug: 'find-faq',
    status: 'ACTIVE',
    executionMode: SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL,
    inputSchema: { type: 'object', required: ['query'] },
  };

  function createService() {
    const knowledgeService = {
      search: vi.fn().mockResolvedValue([{ content: 'Refunds are available.' }]),
    };
    const memoryService = { searchByAgent: vi.fn() };
    const llmRuntime = { generateText: vi.fn() };
    const configService = { get: vi.fn() };
    return {
      service: new SkillEmployeeRuntimeService(
        knowledgeService as never,
        memoryService as never,
        llmRuntime as never,
        configService as never,
      ),
      knowledgeService,
      memoryService,
    };
  }

  it('validates required inputs before invoking a provider', async () => {
    const { service, knowledgeService } = createService();

    await expect(service.execute(step, skill, {}, request)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(knowledgeService.search).not.toHaveBeenCalled();
  });

  it('executes an active skill and returns its provider result', async () => {
    const { service, knowledgeService } = createService();

    const result = await service.execute(step, skill, { query: 'refund policy' }, request);

    expect(result).toEqual([{ content: 'Refunds are available.' }]);
    expect(knowledgeService.search).toHaveBeenCalledWith({
      organizationId: 'org-1',
      query: 'refund policy',
      limit: 5,
      offset: 0,
    });
  });

  it('rejects inactive skills', async () => {
    const { service } = createService();

    await expect(
      service.execute(step, { ...skill, status: 'DRAFT' }, { query: 'x' }, request),
    ).rejects.toEqual(expect.objectContaining({ code: 'SKILL_NOT_ACTIVE' }));
  });

  it('rejects approval-only skills without executing them', async () => {
    const { service, knowledgeService } = createService();

    await expect(
      service.execute(
        step,
        { ...skill, executionMode: SKILL_EXECUTION_MODE.HUMAN_APPROVAL },
        { query: 'x' },
        request,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'APPROVAL_REQUIRED' }));
    expect(knowledgeService.search).not.toHaveBeenCalled();
  });

  it('validates structured output when a skill declares an output schema', async () => {
    const { service } = createService();
    const outputSkill = {
      ...skill,
      executionMode: SKILL_EXECUTION_MODE.AI_ONLY,
      inputSchema: undefined,
      outputSchema: { type: 'object', required: ['answer'] },
    };
    const llmRuntime = (
      service as unknown as { llmRuntime: { generateText: ReturnType<typeof vi.fn> } }
    ).llmRuntime;
    llmRuntime.generateText.mockResolvedValue({ content: 'plain text' });

    await expect(service.execute(step, outputSkill, {}, request)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('exposes structured runtime errors', () => {
    const error = new SkillRuntimeError('PERMISSION_DENIED', 'Not allowed');

    expect(error.name).toBe('SkillRuntimeError');
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.retryable).toBe(false);
  });
});
