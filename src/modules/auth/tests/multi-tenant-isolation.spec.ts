import { describe, expect, it, vi } from 'vitest';
import { AgentsController } from '../../agents/controllers/agents.controller';
import { AgentsService } from '../../agents/services/agents.service';
import { SubscriptionController } from '../../billing/controllers/subscription.controller';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { ChannelsController } from '../../channels/controllers/channels.controller';
import { ChannelsService } from '../../channels/services/channels.service';
import { ConversationsController } from '../../conversations/controllers/conversations.controller';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { IntegrationsController } from '../../integrations/controllers/integrations.controller';
import { IntegrationsService } from '../../integrations/services/integrations.service';
import { MemoryController } from '../../memory/controllers/memory.controller';
import { MemoryService } from '../../memory/services/memory.service';
import { SkillsController } from '../../skills/controllers/skills.controller';
import { SkillsService } from '../../skills/services/skills.service';

describe('Multi-Tenant User Isolation & Authorization', () => {
  const userA = { id: 'user-a', activeContext: 'personal' };
  const userB = { id: 'user-b', activeContext: 'personal' };
  const orgMemberA = { id: 'user-a', activeContext: 'organization', organizationId: 'org-a' };

  describe('Agents Controller Isolation', () => {
    const mockAgentsService = {
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      publish: vi.fn(),
      archive: vi.fn(),
      addSkill: vi.fn(),
      removeSkill: vi.fn(),
      getSkills: vi.fn(),
      findMany: vi.fn(),
    } as unknown as AgentsService;

    const controller = new AgentsController(mockAgentsService);

    it('passes user scope on findById', async () => {
      await controller.findById('agent-1', userA);
      expect(mockAgentsService.findById).toHaveBeenCalledWith('agent-1', true, {
        userId: 'user-a',
        organizationId: undefined,
      });
    });

    it('passes user scope on update, softDelete, publish, archive', async () => {
      await controller.update('agent-1', { name: 'New Name' }, userA);
      expect(mockAgentsService.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ name: 'New Name' }),
        { userId: 'user-a', organizationId: undefined },
      );

      await controller.remove('agent-1', userA);
      expect(mockAgentsService.softDelete).toHaveBeenCalledWith('agent-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.publish('agent-1', userA);
      expect(mockAgentsService.publish).toHaveBeenCalledWith('agent-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.archive('agent-1', userA);
      expect(mockAgentsService.archive).toHaveBeenCalledWith('agent-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });

    it('passes user scope on skill attachments and retrieval', async () => {
      await controller.addSkill('agent-1', 'skill-1', userA);
      expect(mockAgentsService.addSkill).toHaveBeenCalledWith('agent-1', 'skill-1', undefined, {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.removeSkill('agent-1', 'skill-1', userA);
      expect(mockAgentsService.removeSkill).toHaveBeenCalledWith('agent-1', 'skill-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.getSkills('agent-1', userA);
      expect(mockAgentsService.getSkills).toHaveBeenCalledWith('agent-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });
  });

  describe('Conversations Controller Isolation', () => {
    const mockConversationsService = {
      create: vi.fn(),
      findMany: vi.fn(),
      findById: vi.fn(),
      addMessage: vi.fn(),
      getMessages: vi.fn(),
      updateTitle: vi.fn(),
      resolve: vi.fn(),
      archive: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as ConversationsService;

    const controller = new ConversationsController(mockConversationsService);

    it('forces authenticated user context on create and findMany', async () => {
      await controller.create({ agentId: 'agent-1', title: 'Test' }, userA);
      expect(mockConversationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          title: 'Test',
          userId: 'user-a',
          organizationId: undefined,
        }),
      );

      await controller.findMany(userA, 'agent-1');
      expect(mockConversationsService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          userId: 'user-a',
          organizationId: undefined,
        }),
      );
    });

    it('passes user scope on messages, title updates, and status changes', async () => {
      await controller.findById('conv-1', userA);
      expect(mockConversationsService.findById).toHaveBeenCalledWith('conv-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.addMessage('conv-1', { role: 'user', content: 'Hi' }, userA);
      expect(mockConversationsService.addMessage).toHaveBeenCalledWith(
        'conv-1',
        { role: 'user', content: 'Hi' },
        { userId: 'user-a', organizationId: undefined },
      );

      await controller.update('conv-1', { title: 'Updated' }, userA);
      expect(mockConversationsService.updateTitle).toHaveBeenCalledWith('conv-1', 'Updated', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.remove('conv-1', userA);
      expect(mockConversationsService.softDelete).toHaveBeenCalledWith('conv-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });
  });

  describe('Memory Controller Isolation', () => {
    const mockMemoryService = {
      create: vi.fn(),
      findByAgent: vi.fn(),
      searchByAgent: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as MemoryService;

    const controller = new MemoryController(mockMemoryService);

    it('binds user/org context on create, findByAgent, and searchByAgent', async () => {
      await controller.create(
        { agentId: 'agent-1', key: 'pref', content: 'value', type: 'USER' },
        userA,
      );
      expect(mockMemoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-a',
          organizationId: undefined,
        }),
      );

      await controller.findByAgent('agent-1', userA);
      expect(mockMemoryService.findByAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          userId: 'user-a',
          organizationId: undefined,
        }),
      );

      await controller.searchByAgent('agent-1', userA, 'query');
      expect(mockMemoryService.searchByAgent).toHaveBeenCalledWith(
        'agent-1',
        'query',
        expect.objectContaining({
          userId: 'user-a',
          organizationId: undefined,
        }),
      );
    });

    it('scopes findById, update, and remove by user', async () => {
      await controller.findById('mem-1', userA);
      expect(mockMemoryService.findById).toHaveBeenCalledWith('mem-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.update('mem-1', { content: 'updated' }, userA);
      expect(mockMemoryService.update).toHaveBeenCalledWith(
        'mem-1',
        expect.objectContaining({ content: 'updated' }),
        { userId: 'user-a', organizationId: undefined },
      );

      await controller.remove('mem-1', userA);
      expect(mockMemoryService.softDelete).toHaveBeenCalledWith('mem-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });
  });

  describe('Channels & Integrations Isolation', () => {
    const mockChannelsService = {
      findByAgent: vi.fn(),
      findById: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as ChannelsService;
    const channelsController = new ChannelsController(mockChannelsService);

    const mockIntegrationsService = {
      create: vi.fn(),
      findByOrganization: vi.fn(),
      findById: vi.fn(),
      softDelete: vi.fn(),
    } as unknown as IntegrationsService;
    const integrationsController = new IntegrationsController(mockIntegrationsService);

    it('scopes channels by user', async () => {
      await channelsController.findByAgent('agent-1', userA);
      expect(mockChannelsService.findByAgent).toHaveBeenCalledWith('agent-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await channelsController.findById('chan-1', userA);
      expect(mockChannelsService.findById).toHaveBeenCalledWith('chan-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });

    it('scopes integrations by organization and user', async () => {
      await integrationsController.create(
        { name: 'Slack', category: 'COMMUNICATION', provider: 'slack' },
        orgMemberA,
      );
      expect(mockIntegrationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Slack' }),
        { userId: 'user-a', organizationId: 'org-a' },
      );

      await integrationsController.findByOrganization('org-a', orgMemberA);
      expect(mockIntegrationsService.findByOrganization).toHaveBeenCalledWith('org-a', {
        userId: 'user-a',
        organizationId: 'org-a',
      });
    });
  });

  describe('Skills Controller Isolation', () => {
    const mockSkillsService = {
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      publish: vi.fn(),
      archive: vi.fn(),
    } as unknown as SkillsService;
    const controller = new SkillsController(mockSkillsService);

    it('scopes single-skill retrieval and mutations to the user', async () => {
      await controller.findById('skill-1', userA);
      expect(mockSkillsService.findById).toHaveBeenCalledWith('skill-1', {
        userId: 'user-a',
        organizationId: undefined,
      });

      await controller.update('skill-1', { description: 'New description' }, userA);
      expect(mockSkillsService.update).toHaveBeenCalledWith(
        'skill-1',
        expect.objectContaining({ description: 'New description' }),
        { userId: 'user-a', organizationId: undefined },
      );

      await controller.remove('skill-1', userA);
      expect(mockSkillsService.softDelete).toHaveBeenCalledWith('skill-1', {
        userId: 'user-a',
        organizationId: undefined,
      });
    });
  });

  describe('Subscription Controller Isolation', () => {
    const mockSubService = {
      create: vi.fn(),
      upgrade: vi.fn(),
      cancel: vi.fn(),
    } as unknown as SubscriptionService;
    const controller = new SubscriptionController(mockSubService);

    it('scopes upgrade and cancel to the authenticated user', async () => {
      const validPlanId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      await controller.upgrade('sub-1', { planId: validPlanId }, { user: userB } as never);
      expect(mockSubService.upgrade).toHaveBeenCalledWith('sub-1', validPlanId, {
        userId: 'user-b',
        organizationId: undefined,
      });

      await controller.cancel('sub-1', { user: userB } as never);
      expect(mockSubService.cancel).toHaveBeenCalledWith('sub-1', {
        userId: 'user-b',
        organizationId: undefined,
      });
    });
  });
});
