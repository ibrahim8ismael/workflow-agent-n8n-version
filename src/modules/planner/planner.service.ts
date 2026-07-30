import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AIAdapterService } from '../../infrastructure/ai-adapter/ai-adapter.service';
import type { Plan, PlannerInput } from './interfaces/plan.interface';

const planSchema = z.object({
  goal: z.string(),
  reasoning: z.string(),
  steps: z.array(
    z.object({
      skillId: z.string(),
      skillName: z.string(),
      order: z.number(),
      input: z.record(z.unknown()),
      required: z.boolean(),
    }),
  ),
  missingInputs: z.array(
    z.object({
      field: z.string(),
      description: z.string(),
      skillId: z.string(),
    }),
  ),
  successCriteria: z.array(z.string()),
  estimatedComplexity: z.enum(['simple', 'medium', 'complex']),
  requiresApproval: z.boolean(),
});

@Injectable()
export class PlannerService {
  constructor(private readonly aiAdapter: AIAdapterService) {}

  async createPlan(input: PlannerInput): Promise<Plan> {
    const systemPrompt = this.buildSystemPrompt(input);
    const userPrompt = this.buildUserPrompt(input);

    const result = await this.aiAdapter.generateObject({
      model: 'gpt-4o',
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      schema: planSchema,
      temperature: 0.2,
      maxTokens: 2000,
    });

    const plan = result.object as Plan;
    return {
      ...plan,
      agentId: input.agentId,
      conversationId: input.conversationId,
    };
  }

  private buildSystemPrompt(input: PlannerInput): string {
    const skillDescriptions = input.availableSkills
      .map(
        (s) =>
          `- ${s.name} (${s.skillId}): ${s.description ?? 'No description'} [Mode: ${s.executionMode}]`,
      )
      .join('\n');

    const memoryContext =
      input.memory && input.memory.length > 0
        ? `\nRelevant Memory:\n${input.memory.map((m) => `- ${m.key}: ${m.content}`).join('\n')}`
        : '';

    return `You are an AI Planner. Your role is to understand user requests and create execution plans.

Available Skills:
${skillDescriptions}
${memoryContext}

${input.agentInstructions ? `Agent Instructions:\n${input.agentInstructions}\n` : ''}

Rules:
1. Always choose the most relevant Skills for the request.
2. If required information is missing, add it to missingInputs.
3. Skills should be ordered logically (prerequisites first).
4. If the request cannot be fulfilled, set missingInputs explaining why.
5. Never invent Skills that don't exist in the available list.
6. Keep plans as simple as possible.`;
  }

  private buildUserPrompt(input: PlannerInput): string {
    const knowledgeContext =
      input.knowledge && input.knowledge.length > 0
        ? `\nRelevant Knowledge:\n${input.knowledge.join('\n')}\n`
        : '';

    return `${knowledgeContext}
User Request: ${input.userMessage}

Create an execution plan to fulfill this request using the available Skills.`;
  }

  async validatePlan(plan: Plan): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!plan.goal) errors.push('Plan must have a goal');
    if (!plan.steps || plan.steps.length === 0) errors.push('Plan must have at least one step');

    for (const step of plan.steps) {
      if (!step.skillId) errors.push(`Step ${step.order}: missing skillId`);
      if (!step.skillName) errors.push(`Step ${step.order}: missing skillName`);
    }

    return { valid: errors.length === 0, errors };
  }
}
