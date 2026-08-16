import { z } from 'zod';
import { JAAFAR_PLAN_SCHEMA_VERSION } from '../types/jaafar-plan.types';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jaafarPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const input = value as Record<string, unknown>;
    const steps = Array.isArray(input.steps)
      ? input.steps.map((step, index) => {
          if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
          const candidate = step as Record<string, unknown>;
          return {
            ...candidate,
            stepId: candidate.stepId ?? `step-${index + 1}`,
            toolId: candidate.toolId ?? candidate.skillName ?? candidate.skillId,
            order: candidate.order ?? index + 1,
          };
        })
      : input.steps;
    return { ...input, steps };
  },
  z.object({
    schemaVersion: z.literal(JAAFAR_PLAN_SCHEMA_VERSION).default(JAAFAR_PLAN_SCHEMA_VERSION),
    goal: z.string().min(1).max(500),
    steps: z
      .array(
        z.object({
          stepId: z.string().min(1).max(100),
          toolId: z.string().min(1).max(200),
          order: z.number().int().nonnegative(),
          input: jsonValueSchema,
          required: z.boolean(),
          dependsOn: z.array(z.string().min(1).max(100)).max(20).optional(),
        }),
      )
      .max(20),
    successCriteria: z.array(z.string().min(1).max(500)).min(1).max(20),
    requiresApproval: z.boolean(),
    approvalReasons: z.array(z.string().min(1).max(500)).max(20).optional(),
  }),
);

export type JaafarPlanOutput = z.infer<typeof jaafarPlanSchema>;
