import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

/** Trims, then prepends http:// when no scheme present (e.g. "localhost:7777"). */
const baseUrlInput = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
};

const baseUrlSchema = z.preprocess(
  baseUrlInput,
  z
    .string()
    .trim()
    .min(1, { message: 'baseUrl is required' })
    .max(2048)
    .url({ message: 'baseUrl must be a valid URL, e.g. http://localhost:7777' }),
);

const apiKeySchema = z
  .string()
  .trim()
  .min(8, { message: 'apiKey must be at least 8 characters' })
  .max(1024, { message: 'apiKey must be at most 1024 characters' });

const organizationIdSchema = z.preprocess(emptyToUndefined, z.string().uuid().optional());

export const createN8nConnectionSchema = z.object({
  name: z.string().trim().min(1, { message: 'name is required' }).max(120),
  baseUrl: baseUrlSchema,
  apiKey: apiKeySchema,
  organizationId: organizationIdSchema,
});
export type CreateN8nConnectionDto = z.infer<typeof createN8nConnectionSchema>;

export const updateN8nConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.preprocess(
    (v) => (v === undefined ? undefined : baseUrlInput(v)),
    z.string().trim().min(1).max(2048).url().optional(),
  ),
  apiKey: z.string().trim().min(8).max(1024).optional(), // rotation
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), // resume / suspend
});
export type UpdateN8nConnectionDto = z.infer<typeof updateN8nConnectionSchema>;
