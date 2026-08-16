import { Injectable } from '@nestjs/common';
import { AgentsService } from '../../agents/services/agents.service';
import { ChannelsService } from '../../channels/services/channels.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { IntegrationsService } from '../../integrations/services/integrations.service';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import type { ToolDefinition } from '../interfaces/tool.interface';
import { ToolRegistryService } from './tool-registry.service';

export interface JaafarContextLoadRequest {
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  mode?: 'conversation' | 'planning' | 'employee_design' | 'execution';
  readiness?: string[];
}

export interface JaafarLoadedContext {
  agent: {
    id: string;
    name: string;
    description?: string;
    instructions?: string;
    organizationId?: string;
  };
  history: Array<{ role: string; content: string }>;
  tools: ToolDefinition[];
  memoryReferences: string[];
  knowledgeReferences: string[];
  readiness: Array<{ capability: string; integrationReady: boolean; channelReady: boolean }>;
}

@Injectable()
export class JaafarContextLoaderService {
  private readonly historyLimit = 20;
  private readonly retrievalLimit = 5;

  constructor(
    private readonly agents: AgentsService,
    private readonly conversations: ConversationsService,
    private readonly tools: ToolRegistryService,
    private readonly memory: MemoryService,
    private readonly knowledge: KnowledgeService,
    private readonly integrations: IntegrationsService,
    private readonly channels: ChannelsService,
  ) {}

  async load(request: JaafarContextLoadRequest): Promise<JaafarLoadedContext> {
    const agent = await this.agents.findById(request.agentId, false, {
      userId: request.userId,
      organizationId: request.organizationId,
    });
    const [history, tools, memories, knowledge, readiness] = await Promise.all([
      this.loadHistory(request.conversationId),
      this.tools.listForAgent(request.agentId, {
        mode: request.mode,
        userId: request.userId,
        organizationId: request.organizationId,
      }),
      this.memory.findByAgent(request.agentId, {
        userId: request.userId,
        take: this.retrievalLimit,
      }),
      this.loadKnowledge(request),
      this.loadReadiness(request),
    ]);

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description ?? undefined,
        instructions: agent.instructions ?? undefined,
        organizationId: agent.organizationId ?? undefined,
      },
      history,
      tools,
      memoryReferences: memories.map((memory) => memory.id),
      knowledgeReferences: knowledge.map((item) => item.knowledgeDocumentId),
      readiness,
    };
  }

  private async loadHistory(conversationId?: string) {
    if (!conversationId) return [];
    const messages = await this.conversations.getMessages(conversationId, {
      take: this.historyLimit,
    });
    return messages.map((message) => ({ role: message.role, content: message.content }));
  }

  private async loadKnowledge(request: JaafarContextLoadRequest) {
    if (!request.userMessage.trim()) return [];
    return this.knowledge.search({
      userId: request.userId,
      organizationId: request.organizationId,
      query: request.userMessage,
      limit: this.retrievalLimit,
      offset: 0,
    });
  }

  private async loadReadiness(request: JaafarContextLoadRequest) {
    if (!request.readiness?.length) return [];
    return Promise.all(
      request.readiness.slice(0, this.retrievalLimit).map(async (capability) => {
        const [integrationReady, channelReady] = await Promise.all([
          request.organizationId
            ? this.integrations.isConnected(request.organizationId, capability)
            : Promise.resolve(false),
          this.channels.isAvailable(request.agentId, capability),
        ]);
        return { capability, integrationReady, channelReady };
      }),
    );
  }
}
