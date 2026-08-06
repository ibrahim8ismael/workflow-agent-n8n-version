import { Injectable } from '@nestjs/common';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';

export interface ContextBuilderInput {
  systemPrompt?: string;
  agentInstructions?: string;
  agentId: string;
  conversationId?: string;
  organizationId?: string;
  userMessage: string;
  skillInstructions?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface BuiltContext {
  system: string;
  messages: Array<{ role: string; content: string }>;
  metadata: {
    memoryCount: number;
    knowledgeCount: number;
    totalTokens: number;
  };
}

@Injectable()
export class ContextBuilderService {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async build(input: ContextBuilderInput): Promise<BuiltContext> {
    const systemParts: string[] = [];

    if (input.systemPrompt) systemParts.push(input.systemPrompt);
    if (input.agentInstructions) systemParts.push(input.agentInstructions);
    if (input.skillInstructions) systemParts.push(input.skillInstructions);

    const system = systemParts.join('\n\n');

    const messages: Array<{ role: string; content: string }> = [];

    if (input.conversationHistory && input.conversationHistory.length > 0) {
      const recentHistory = input.conversationHistory.slice(-20);
      messages.push(...recentHistory);
    }

    let memoryCount = 0;
    let knowledgeCount = 0;

    if (input.agentId) {
      const [memories, knowledge] = await Promise.all([
        this.withTimeout(this.memoryService.findByAgent(input.agentId, { take: 5 }), 500).catch(
          () => [],
        ),
        input.organizationId
          ? this.withTimeout(
              this.knowledgeService.search({
                query: input.userMessage,
                organizationId: input.organizationId,
                limit: 3,
                offset: 0,
              }),
              800,
            ).catch(() => [])
          : Promise.resolve([]),
      ]);

      if (memories.length > 0) {
        const memoryContext = memories.map((m) => `[Memory: ${m.key}] ${m.content}`).join('\n');
        messages.push({ role: 'system', content: `Relevant memories:\n${memoryContext}` });
        memoryCount = memories.length;
      }

      if (knowledge.length > 0) {
        const knowledgeContext = knowledge.map((k) => `[Knowledge] ${k.content}`).join('\n');
        messages.push({ role: 'system', content: `Relevant knowledge:\n${knowledgeContext}` });
        knowledgeCount = knowledge.length;
      }
    }

    messages.push({ role: 'user', content: input.userMessage });

    return {
      system,
      messages,
      metadata: {
        memoryCount,
        knowledgeCount,
        totalTokens:
          this.estimateTokens(system) +
          messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0),
      },
    };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Context dependency timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
}
