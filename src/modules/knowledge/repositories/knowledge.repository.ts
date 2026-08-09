import { Injectable } from '@nestjs/common';
import { KnowledgeDocument, KnowledgeDocumentChunk, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class KnowledgeRepository {
  constructor(private readonly db: DatabaseService) {}

  async createDocument(data: Prisma.KnowledgeDocumentCreateInput): Promise<KnowledgeDocument> {
    return this.db.knowledgeDocument.create({ data });
  }

  async findDocumentById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocument | null> {
    return this.db.knowledgeDocument.findFirst({
      where: {
        id,
        ...this.scopeWhere(scope),
        deletedAt: null,
      },
    });
  }

  async findDocuments(params?: {
    where?: Prisma.KnowledgeDocumentWhereInput;
    orderBy?: Prisma.KnowledgeDocumentOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<KnowledgeDocument[]> {
    return this.db.knowledgeDocument.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async updateDocument(
    id: string,
    data: Prisma.KnowledgeDocumentUpdateInput,
  ): Promise<KnowledgeDocument> {
    return this.db.knowledgeDocument.update({ where: { id }, data });
  }

  async softDeleteDocument(id: string): Promise<KnowledgeDocument> {
    return this.db.knowledgeDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async createChunk(
    data: Prisma.KnowledgeDocumentChunkCreateInput,
  ): Promise<KnowledgeDocumentChunk> {
    return this.db.knowledgeDocumentChunk.create({ data });
  }

  async createChunks(data: Prisma.KnowledgeDocumentChunkCreateManyInput[]): Promise<number> {
    const result = await this.db.knowledgeDocumentChunk.createMany({ data });
    return result.count;
  }

  async findChunksByDocumentId(
    documentId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocumentChunk[]> {
    return this.db.knowledgeDocumentChunk.findMany({
      where: {
        knowledgeDocumentId: documentId,
        ...(scope ? { knowledgeDocument: { ...this.scopeWhere(scope), deletedAt: null } } : {}),
        deletedAt: null,
      },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  async deleteChunksByDocumentId(documentId: string): Promise<number> {
    const result = await this.db.knowledgeDocumentChunk.updateMany({
      where: { knowledgeDocumentId: documentId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async searchChunks(
    scope: { userId?: string; organizationId?: string },
    query: string,
    options?: { category?: string; limit?: number; offset?: number },
  ): Promise<KnowledgeDocumentChunk[]> {
    const where: Prisma.KnowledgeDocumentChunkWhereInput = {
      content: { contains: query, mode: 'insensitive' },
      knowledgeDocument: { ...this.scopeWhere(scope), deletedAt: null },
      deletedAt: null,
    };

    if (options?.category) {
      where.knowledgeDocument = {
        ...(where.knowledgeDocument as Prisma.KnowledgeDocumentWhereInput),
        metadata: { path: ['category'], equals: options.category },
      };
    }

    return this.db.knowledgeDocumentChunk.findMany({
      where,
      take: options?.limit ?? 10,
      skip: options?.offset ?? 0,
    });
  }

  async countDocuments(where?: Prisma.KnowledgeDocumentWhereInput): Promise<number> {
    return this.db.knowledgeDocument.count({ where: { ...where, deletedAt: null } });
  }

  private scopeWhere(scope?: {
    userId?: string;
    organizationId?: string;
  }): Prisma.KnowledgeDocumentWhereInput {
    const scopes: Prisma.KnowledgeDocumentWhereInput[] = [];
    if (scope?.userId) scopes.push({ userId: scope.userId });
    if (scope?.organizationId) scopes.push({ organizationId: scope.organizationId });
    if (scopes.length === 0) return { id: '__no_access__' };
    if (scopes.length === 1) return scopes[0];
    return { OR: scopes };
  }
}
