import { z } from 'zod';

export const toolModeSchema = z.enum([
  'conversation',
  'planning',
  'automation_design',
  'execution',
]);

export const toolManifestSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    parameters: z.record(z.unknown()),
  }),
  woops: z.object({
    kind: z.enum(['read', 'draft', 'mutate', 'external', 'destructive']),
    implemented: z.boolean(),
    sideEffect: z.enum([
      'none',
      'record_creation',
      'record_update',
      'production_visibility',
      'production_activation',
      'external_communication',
      'destructive_change',
    ]),
    approval: z.enum(['not_required', 'required']),
    scope: z.enum(['employee', 'user_or_organization', 'organization']),
    availableIn: z.array(toolModeSchema).min(1),
    idempotencyKey: z.string().min(1).optional(),
  }),
});

export const toolManifestListSchema = z.array(toolManifestSchema);

export type ToolMode = z.infer<typeof toolModeSchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;
