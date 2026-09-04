import { z } from 'zod';

/** Payload used by the runtime when handing an approved design to provisioning. */
export const createAutomationFromBlueprintSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1200).optional(),
  blueprint: z.record(z.string(), z.unknown()),
  connectionId: z.string().uuid().optional(),
});

export type CreateAutomationFromBlueprintDto = z.infer<typeof createAutomationFromBlueprintSchema>;

export const approveAutomationSchema = z.object({
  blueprintRevision: z.string().max(64).optional(),
});

export type ApproveAutomationDto = z.infer<typeof approveAutomationSchema>;
