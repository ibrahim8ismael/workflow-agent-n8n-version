import { describe, expect, it, vi } from 'vitest';
import { EmployeeDesignRuntimeService } from './employee-design-runtime.service';

const blueprint = {
  ready: true,
  missingRequirements: [],
  name: 'HR Assistant',
  role: 'HR coordinator',
  department: 'People Operations',
  summary: 'Supports employee questions and onboarding.',
  description: 'Supports employee questions and onboarding.',
  instructions: 'Answer policy questions and escalate sensitive cases.',
  responsibilities: ['Answer HR questions'],
  goals: ['Reduce response time'],
  knowledgeRequirements: ['Company handbook'],
  requiredTools: ['Knowledge search'],
  requiredIntegrations: [],
  channels: ['Slack'],
  memoryPolicy: 'Remember confirmed company policies only.',
  permissions: ['Read approved HR knowledge'],
  workflow: ['Understand the question', 'Answer or escalate'],
};

function createService() {
  const runsService = {
    create: vi.fn().mockResolvedValue({ id: 'design-run-1' }),
    transitionStatus: vi.fn(),
    updateUsage: vi.fn(),
    updateMetadata: vi.fn(),
    complete: vi.fn().mockResolvedValue({
      id: 'design-run-1',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    }),
    fail: vi.fn(),
    findById: vi.fn(),
  };
  const agentsService = {
    findById: vi.fn().mockResolvedValue({ instructions: 'Design helper policy.' }),
    create: vi.fn().mockResolvedValue({ id: 'employee-1', name: 'HR Assistant' }),
  };
  const conversationsService = { getMessages: vi.fn().mockResolvedValue([]) };
  const memoryService = { upsert: vi.fn().mockResolvedValue({}) };
  const contextBuilder = {
    build: vi
      .fn()
      .mockResolvedValue({ system: 'system', messages: [{ role: 'user', content: 'x' }] }),
  };
  const llmRuntime = {
    generateObject: vi.fn().mockResolvedValue({
      object: blueprint,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
  };

  return {
    service: new EmployeeDesignRuntimeService(
      runsService as never,
      agentsService as never,
      conversationsService as never,
      memoryService as never,
      contextBuilder as never,
      llmRuntime as never,
    ),
    runsService,
    agentsService,
    memoryService,
    llmRuntime,
  };
}

describe('EmployeeDesignRuntimeService', () => {
  it('returns a reviewable blueprint without creating an employee', async () => {
    const { service, agentsService } = createService();

    const result = await service.run({
      agentId: 'chat-agent',
      userMessage: 'Design an HR employee',
      mode: 'employee_design' as never,
    });

    expect(result.plan).toMatchObject({
      name: 'HR Assistant',
      description: blueprint.description,
      instructions: blueprint.instructions,
    });
    expect(result.response).toContain('Draft employee blueprint');
    expect(agentsService.create).not.toHaveBeenCalled();
  });

  it('creates a draft employee and approved profile memory only after confirmation', async () => {
    const { service, runsService, agentsService, memoryService } = createService();
    runsService.findById.mockResolvedValue({
      id: 'design-run-1',
      organizationId: 'org-1',
      metadata: { designStatus: 'READY_FOR_REVIEW', blueprint },
    });

    const result = await service.confirm('design-run-1');

    expect(agentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HR Assistant',
        description: blueprint.description,
        instructions: blueprint.instructions,
        status: 'DRAFT',
        organizationId: 'org-1',
      }),
    );
    expect(memoryService.upsert).toHaveBeenCalledWith(
      'employee-1',
      'employee-profile',
      'AGENT',
      expect.stringContaining('Remember confirmed company policies only.'),
      expect.objectContaining({ source: 'employee-design-confirmation' }),
    );
    expect(result.plan).toMatchObject({ agentId: 'employee-1' });
    expect(runsService.updateMetadata).toHaveBeenCalledWith(
      'design-run-1',
      expect.objectContaining({ approvalStatus: 'APPROVED' }),
    );
  });

  it('does not mark an incomplete design as ready for confirmation', async () => {
    const incompleteBlueprint = {
      ...blueprint,
      ready: false,
      missingRequirements: ['Which HR channels should this employee use?'],
    };
    const runtime = createService();
    runtime.llmRuntime.generateObject.mockResolvedValue({
      object: incompleteBlueprint,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runtime.service.run({
      agentId: 'chat-agent',
      userMessage: 'I need an HR employee',
      mode: 'employee_design' as never,
    });

    expect(result.response).toContain('Which HR channels');
    expect(runtime.runsService.updateMetadata).toHaveBeenCalledWith(
      'design-run-1',
      expect.objectContaining({ designStatus: 'GATHERING_REQUIREMENTS' }),
    );
    expect(runtime.runsService.updateMetadata).toHaveBeenCalled();
  });

  it('does not create a second employee when confirmation is repeated', async () => {
    const { service, runsService, agentsService, memoryService } = createService();
    runsService.findById.mockResolvedValue({
      id: 'design-run-1',
      metadata: { designStatus: 'CREATED', createdAgentId: 'employee-1', blueprint },
    });
    agentsService.findById.mockResolvedValue({ id: 'employee-1', name: 'HR Assistant' });

    const result = await service.confirm('design-run-1');

    expect(result.response).toContain('already created');
    expect(agentsService.create).not.toHaveBeenCalled();
    expect(memoryService.upsert).not.toHaveBeenCalled();
  });
});
