import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeDocument, KnowledgeDocumentChunk } from '@prisma/client';
import { KNOWLEDGE_MAX_CONTENT_BYTES } from '../constants/knowledge.constants';
import { CreateKnowledgeDocumentDto } from '../dto/create-knowledge.dto';
import { SearchKnowledgeDto } from '../dto/search-knowledge.dto';
import { KnowledgeRepository } from '../repositories/knowledge.repository';

@Injectable()
export class KnowledgeService {
  constructor(private readonly knowledgeRepository: KnowledgeRepository) {}

  async createDocument(dto: CreateKnowledgeDocumentDto): Promise<KnowledgeDocument> {
    this.assertMarkdown(dto.contentType);
    this.assertContentSize(dto.content);
    const metadata = {
      ...(dto.metadata ?? {}),
      ...(dto.category ? { category: dto.category } : {}),
    };

    return this.knowledgeRepository.createDocument({
      title: dto.title,
      source: dto.source,
      contentType: dto.contentType,
      content: dto.content,
      metadata: Object.keys(metadata).length > 0 ? (metadata as never) : undefined,
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
    } as never);
  }

  async findDocumentById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocument> {
    const doc = await this.knowledgeRepository.findDocumentById(id, scope);
    if (!doc) throw new NotFoundException(`Knowledge document with id "${id}" not found`);
    return doc;
  }

  async findDocuments(params?: {
    userId?: string;
    organizationId?: string;
    skip?: number;
    take?: number;
  }): Promise<KnowledgeDocument[]> {
    return this.knowledgeRepository.findDocuments({
      where:
        params?.userId || params?.organizationId
          ? {
              OR: [
                ...(params.userId ? [{ userId: params.userId }] : []),
                ...(params.organizationId ? [{ organizationId: params.organizationId }] : []),
              ],
            }
          : undefined,
      orderBy: { createdAt: 'desc' },
      skip: params?.skip,
      take: params?.take,
    });
  }

  async search(dto: SearchKnowledgeDto): Promise<KnowledgeDocumentChunk[]> {
    return this.knowledgeRepository.searchChunks(
      { userId: dto.userId, organizationId: dto.organizationId },
      dto.query,
      {
        category: dto.category,
        limit: dto.limit,
        offset: dto.offset,
      },
    );
  }

  async getDocumentChunks(
    documentId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocumentChunk[]> {
    await this.findDocumentById(documentId, scope);
    return scope
      ? this.knowledgeRepository.findChunksByDocumentId(documentId, scope)
      : this.knowledgeRepository.findChunksByDocumentId(documentId);
  }

  async ingestDocument(
    dto: CreateKnowledgeDocumentDto,
    content: string,
  ): Promise<KnowledgeDocument> {
    this.assertMarkdown(dto.contentType);
    if (!content.trim()) {
      throw new BadRequestException('Markdown content cannot be empty');
    }
    this.assertContentSize(content);

    const doc = await this.createDocument({ ...dto, content });

    const chunks = this.chunkContent(content, 1000, 200);
    await this.knowledgeRepository.createChunks(
      chunks.map((chunk, index) => ({
        knowledgeDocumentId: doc.id,
        content: chunk,
        chunkIndex: index,
        metadata: { source: dto.source, title: dto.title },
      })),
    );

    return doc;
  }

  async updateDocument(
    id: string,
    dto: Partial<CreateKnowledgeDocumentDto>,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocument> {
    const existing = await this.findDocumentById(id, scope);
    if (dto.contentType) this.assertMarkdown(dto.contentType);
    if (dto.content !== undefined) {
      if (!dto.content.trim()) {
        throw new BadRequestException('Markdown content cannot be empty');
      }
      this.assertContentSize(dto.content);
    }

    const metadata = {
      ...(dto.metadata ?? {}),
      ...(dto.category ? { category: dto.category } : {}),
    };

    const updated = await this.knowledgeRepository.updateDocument(id, {
      title: dto.title,
      source: dto.source,
      contentType: dto.contentType,
      content: dto.content,
      ...(Object.keys(metadata).length > 0 ? { metadata: metadata as never } : {}),
    } as never);

    if (dto.content !== undefined) {
      await this.knowledgeRepository.deleteChunksByDocumentId(id);
      const chunks = this.chunkContent(dto.content, 1000, 200);
      await this.knowledgeRepository.createChunks(
        chunks.map((chunk, index) => ({
          knowledgeDocumentId: id,
          content: chunk,
          chunkIndex: index,
          metadata: {
            source: dto.source ?? existing.source,
            title: dto.title ?? existing.title,
          },
        })),
      );
    }

    return updated;
  }

  async softDeleteDocument(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<KnowledgeDocument> {
    await this.findDocumentById(id, scope);
    await this.knowledgeRepository.deleteChunksByDocumentId(id);
    return this.knowledgeRepository.softDeleteDocument(id);
  }

  async countDocuments(organizationId?: string): Promise<number> {
    return this.knowledgeRepository.countDocuments(organizationId ? { organizationId } : undefined);
  }

  private chunkContent(content: string, maxChunkSize: number, overlap: number): string[] {
    if (content.length <= maxChunkSize) return [content];

    const chunks: string[] = [];
    const step = Math.max(maxChunkSize - overlap, 1);
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + maxChunkSize, content.length);
      chunks.push(content.slice(start, end));
      if (end >= content.length) break;
      start += step;
    }

    return chunks;
  }

  private assertMarkdown(contentType: string | undefined): void {
    if (contentType !== 'markdown') {
      throw new BadRequestException('Knowledge documents must use contentType "markdown"');
    }
  }

  private assertContentSize(content: string | undefined): void {
    if (content && Buffer.byteLength(content, 'utf8') > KNOWLEDGE_MAX_CONTENT_BYTES) {
      throw new BadRequestException(
        `Markdown content cannot exceed ${KNOWLEDGE_MAX_CONTENT_BYTES} bytes (5 MB)`,
      );
    }
  }
}
