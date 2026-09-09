import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JaafarContextManagerService } from './jaafar-context-manager.service';

describe('JaafarContextManagerService', () => {
  const loader = { load: vi.fn() };
  const registry = { capabilitiesForScope: vi.fn() };
  const automations = { list: vi.fn() };
  const agentRuns = { snapshot: vi.fn() };

  const service = () =>
    new JaafarContextManagerService(
      loader as never,
      registry as never,
      automations as never,
      agentRuns as never,
    );

  const loaded = (overrides: Record<string, unknown> = {}) => ({
    agent: {
      id: 'agent-1',
      name: 'Jaafar',
      description: 'Business guide',
      instructions: 'Be kind',
    },
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ],
    tools: [
      {
        id: 'knowledge_search',
        description: 'Search business knowledge',
        requiresApproval: false,
      },
    ],
    memoryReferences: [],
    knowledgeReferences: [],
    readiness: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    loader.load.mockResolvedValue(loaded());
    registry.capabilitiesForScope.mockResolvedValue([
      {
        provider: 'slack',
        displayName: 'Slack',
        source: 'n8n',
        connectionStatus: 'CONNECTED',
        credentialsAvailable: true,
        credentialType: 'slackOAuth2Api',
      },
    ]);
    automations.list.mockResolvedValue([
      { id: 'auto-1', name: 'Order sync', status: 'ACTIVE', description: 'Syncs orders' },
    ]);
    agentRuns.snapshot.mockResolvedValue({
      run: { status: 'FAILED', currentPhase: 'BUILDING', error: 'boom', repairAttempts: [] },
      transitions: [
        {
          fromPhase: 'PLANNING',
          toPhase: 'BUILDING',
          fromStatus: 'EXECUTING',
          toStatus: 'EXECUTING',
          reason: 'plan approved',
        },
      ],
    });
  });

  it('builds a lean UNDERSTANDING context without integrations or tools', async () => {
    const context = await service().buildForStage({
      stage: 'UNDERSTANDING',
      agentId: 'agent-1',
      userMessage: 'hello',
      conversationId: 'conv-1',
      businessProfile: { name: 'Acme', industry: 'retail' },
    });

    expect(Object.keys(context.sections).sort()).toEqual(
      ['agent', 'business', 'conversation'].sort(),
    );
    expect(context.sections.business.body).toContain('Acme');
    expect(registry.capabilitiesForScope).not.toHaveBeenCalled();
    const prompt = service().renderToPromptText(context);
    expect(prompt).toContain('## Agent');
    expect(prompt).toContain('## Business');
  });

  it('adds integrations, tools and workflows for BUILDING', async () => {
    const context = await service().buildForStage({
      stage: 'BUILDING',
      agentId: 'agent-1',
      userMessage: 'build it',
      organizationId: 'org-1',
    });

    expect(context.sections.integration.body).toContain('Slack [CONNECTED]');
    expect(context.sections.tools.body).toContain('knowledge_search');
    expect(context.sections.workflow.body).toContain('Order sync [ACTIVE]');
  });

  it('builds a FAILURE context from the run trail', async () => {
    const context = await service().buildForStage({
      stage: 'FAILURE',
      agentId: 'agent-1',
      userMessage: 'fix it',
      runId: 'run-1',
    });

    expect(context.sections.failure.body).toContain('Status: FAILED');
    expect(context.sections.failure.body).toContain('Last error: boom');
    expect(context.sections.failure.body).toContain('PLANNING → BUILDING');
    expect(agentRuns.snapshot).toHaveBeenCalledWith('run-1');
  });

  it('degrades optional sections instead of throwing', async () => {
    registry.capabilitiesForScope.mockRejectedValue(new Error('n8n down'));
    automations.list.mockRejectedValue(new Error('db down'));

    const context = await service().buildForStage({
      stage: 'BUILDING',
      agentId: 'agent-1',
      userMessage: 'build it',
    });

    expect(context.sections.integration.unavailable).toBe(true);
    expect(context.sections.workflow.unavailable).toBe(true);
    expect(context.sections.agent.body).toContain('Jaafar');
  });

  it('enforces budgets and reports truncation', async () => {
    loader.load.mockResolvedValue(
      loaded({
        history: Array.from({ length: 30 }, (_, i) => ({
          role: 'user',
          content: `message ${i} `.padEnd(500, 'x'),
        })),
      }),
    );

    const context = await service().buildForStage({
      stage: 'PLANNING',
      agentId: 'agent-1',
      userMessage: 'plan it',
    });

    expect(context.totalChars).toBeLessThanOrEqual(12_000);
    expect(context.truncated).toContain('conversation');
    expect(context.sections.conversation.truncated).toBe(true);
  });
});
