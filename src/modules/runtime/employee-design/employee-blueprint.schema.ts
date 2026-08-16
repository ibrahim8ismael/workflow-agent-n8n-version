import { z } from 'zod';

export const blueprintSchema = z.object({
  ready: z.boolean(),
  missingRequirements: z.array(z.string()),
  name: z.string(),
  role: z.string(),
  department: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  goals: z.array(z.string()),
  knowledgeRequirements: z.array(z.string()),
  requiredTools: z.array(z.string()),
  requiredIntegrations: z.array(z.string()),
  channels: z.array(z.string()),
  memoryPolicy: z.string(),
  permissions: z.array(z.string()),
  workflow: z.array(z.string()),
  description: z.string(),
  instructions: z.string(),
});

export type EmployeeBlueprint = z.infer<typeof blueprintSchema>;
