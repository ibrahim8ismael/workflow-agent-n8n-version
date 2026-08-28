import { z } from 'zod';

export const createN8nConnectionSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string().min(8).max(256),
  organizationId: z.string().uuid().optional(),
});
export type CreateN8nConnectionDto = z.infer<typeof createN8nConnectionSchema>;

export const updateN8nConnectionSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(8).max(256).optional(), // rotation
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), // resume / suspend
});
export type UpdateN8nConnectionDto = z.infer<typeof updateN8nConnectionSchema>;
