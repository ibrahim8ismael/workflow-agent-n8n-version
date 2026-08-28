import { z } from 'zod';

export const jaafarUnderstandingSchema = z.object({
  intent: z.enum(['conversation', 'automation_design', 'task_execution', 'general_question']),
  goal: z.string().min(1).max(500),
  businessContext: z.string().max(1000).default(''),
  requirements: z
    .array(
      z.object({
        field: z.string().min(1).max(100),
        value: z.string().max(500),
        required: z.boolean(),
        source: z.enum(['user', 'history', 'inferred', 'retrieved']),
      }),
    )
    .max(20)
    .default([]),
  missingInputs: z
    .array(
      z.object({
        field: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        question: z.string().min(1).max(500),
        required: z.boolean(),
      }),
    )
    .max(10),
  confidence: z.number().min(0).max(1).default(1),
  clarificationRequired: z.boolean().default(false),
  clarificationQuestion: z.string().max(500).optional(),
});

export type JaafarUnderstandingOutput = z.infer<typeof jaafarUnderstandingSchema>;
