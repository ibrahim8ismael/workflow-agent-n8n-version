import { z } from 'zod';

const offlineCaseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('classify-error'),
    message: z.string(),
    stage: z.string().optional(),
    statusCode: z.number().optional(),
    expectedCode: z.string(),
    expectedRetryable: z.boolean().optional(),
    expectedActionContains: z.string().optional(),
  }),
  z.object({
    kind: z.literal('review-plan'),
    blueprint: z.unknown(),
    requirements: z
      .array(z.object({ id: z.string().optional(), field: z.string(), required: z.boolean() }))
      .optional(),
    conditions: z.array(z.string()).optional(),
    capabilities: z
      .array(
        z.object({
          provider: z.string(),
          displayName: z.string(),
          source: z.enum(['n8n', 'platform']),
          connectionStatus: z.string(),
          credentialsAvailable: z.boolean(),
          nodeTypes: z.array(z.string()).optional(),
          suggestedNodeType: z.string().optional(),
        }),
      )
      .optional(),
    instanceNodeTypes: z.array(z.string()).optional(),
    genericOverride: z
      .object({ requested: z.boolean(), type: z.enum(['httpRequest', 'code']).optional() })
      .optional(),
    expectedValid: z.boolean(),
    expectedErrorCodes: z.array(z.string()).optional(),
    expectedWarningCodes: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('validate-workflow'),
    blueprint: z.unknown(),
    requirements: z
      .array(z.object({ id: z.string().optional(), field: z.string(), required: z.boolean() }))
      .optional(),
    capabilities: z
      .array(
        z.object({
          provider: z.string(),
          displayName: z.string(),
          source: z.enum(['n8n', 'platform']),
          connectionStatus: z.string(),
          credentialsAvailable: z.boolean(),
          nodeTypes: z.array(z.string()).optional(),
          suggestedNodeType: z.string().optional(),
        }),
      )
      .optional(),
    expectedValid: z.boolean(),
    expectedErrorCodes: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('assumption-policy'),
    assumptions: z.array(
      z.object({
        statement: z.string(),
        rationale: z.string().optional(),
        reversible: z.boolean(),
        risk: z.enum(['low', 'medium', 'high']),
      }),
    ),
    missingInputs: z
      .array(
        z.object({
          field: z.string(),
          description: z.string(),
          question: z.string(),
          required: z.boolean(),
        }),
      )
      .optional(),
    expectedClarification: z.boolean(),
    expectedQuestionContains: z.string().optional(),
  }),
]);

export const evalScenarioSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    'basic',
    'mapping',
    'logic',
    'integrations',
    'failure',
    'reliability',
    'ambiguous',
    'complex',
  ]),
  input: z.string().min(1),
  expectedIntent: z.string().optional(),
  expectedOutcome: z.string(),
  offline: offlineCaseSchema.nullable(),
});

export const evalDatasetSchema = z.object({
  version: z.number(),
  purpose: z.string(),
  scenarios: z.array(evalScenarioSchema).min(1),
});

export type EvalScenario = z.infer<typeof evalScenarioSchema>;
export type EvalDataset = z.infer<typeof evalDatasetSchema>;
