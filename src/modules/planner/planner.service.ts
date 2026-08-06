import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LLMRuntimeService } from '../../infrastructure/llm-runtime/llm-runtime.service';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from '../../infrastructure/prompts/system-prompts';
import { Plan, PlannerInput } from './interfaces/plan.interface';

const planSchema = z.object({
  intent: z.enum([
    'brainstorming',
    'employee_design',
    'task_execution',
    'clarification',
    'general_question',
  ]),
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
  approvalReasons: z.array(z.string()),
  unavailableCapabilities: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

@Injectable()
export class PlannerService {
  constructor(private readonly llmRuntime: LLMRuntimeService) {}

  async createPlan(input: PlannerInput): Promise<Plan> {
    const availableSkills = input.availableSkills
      .map(
        (s) =>
          `- ${s.name} (${s.skillId}): ${s.description ?? 'No description'} [Mode: ${s.executionMode}]`,
      )
      .join('\n');
    const memory = input.memory?.map((m) => `- ${m.key}: ${m.content}`).join('\n');
    const knowledge = input.knowledge?.join('\n');

    const result = await this.llmRuntime.generateObject({
      mode: input.effort ?? 'high',
      systemPrompt: buildPlannerSystemPrompt({
        availableSkills,
        memory,
        agentInstructions: input.agentInstructions,
      }),
      messages: [
        {
          role: 'user',
          content: buildPlannerUserPrompt({
            userMessage: input.userMessage,
            knowledge,
            conversationHistory: input.conversationHistory,
          }),
        },
      ],
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

  async validatePlan(plan: Plan): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!plan.goal) errors.push('Plan must have a goal');
    if ((!plan.steps || plan.steps.length === 0) && plan.missingInputs.length === 0) {
      errors.push('Plan must have at least one step');
    }

    for (const step of plan.steps) {
      if (!step.skillId) errors.push(`Step ${step.order}: missing skillId`);
      if (!step.skillName) errors.push(`Step ${step.order}: missing skillName`);
    }

    return { valid: errors.length === 0, errors };
  }
}
