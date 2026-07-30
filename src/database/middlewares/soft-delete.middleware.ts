import type { PrismaClient } from '@prisma/client';

export function setupSoftDeleteMiddleware(_prisma: PrismaClient): void {
  // Soft delete is handled in the BaseRepository
  // Prisma 7 removed the $use middleware API
}
