import { Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeDocument, KnowledgeDocumentChunk } from '@prisma/client';
import { CreateKnowledgeDocumentDto } from '../dto/create-knowledge.dto';
import { SearchKnowledgeDto } from '../dto/search-knowledge.dto';
import { KnowledgeRepository } from '../repositories/knowledge.repository';

@Injectable()
export class KnowledgeService {
  constructor(private readonly knowledgeRepository: KnowledgeRepository) {}

  async createDocument(dto: CreateKnowledgeDocumentDto): Promise<KnowledgeDocument> {
    return this.knowledgeRepository.createDocument({
      title: dto.title,
      source: dto.source,
      contentType: dto.contentType,
      content: dto.content,
      metadata: dto.metadata as never,
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
    } as never);
  }

  async findDocumentById(id: string): Promise<KnowledgeDocument> {
    const doc = await this.knowledgeRepository.findDocumentById(id);
    if (!doc) throw new NotFoundException(`Knowledge document with id "${id}" not found`);
    return doc;
  }

  async findDocuments(params?: {
    organizationId?: string;
    skip?: number;
    take?: number;
  }): Promise<KnowledgeDocument[]> {
    return this.knowledgeRepository.findDocuments({
      where: params?.organizationId ? { organizationId: params.organizationId } : undefined,
      orderBy: { createdAt: 'desc' },
      skip: params?.skip,
      take: params?.take,
    });
  }

  async search(dto: SearchKnowledgeDto): Promise<KnowledgeDocumentChunk[]> {
    return this.knowledgeRepository.searchChunks(dto.organizationId ?? '', dto.query, {
      category: dto.category,
      limit: dto.limit,
      offset: dto.offset,
    });
  }

  async getDocumentChunks(documentId: string): Promise<KnowledgeDocumentChunk[]> {
    await this.findDocumentById(documentId);
    return this.knowledgeRepository.findChunksByDocumentId(documentId);
  }

  async ingestDocument(
    dto: CreateKnowledgeDocumentDto,
    content: string,
  ): Promise<KnowledgeDocument> {
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
  ): Promise<KnowledgeDocument> {
    await this.findDocumentById(id);
    return this.knowledgeRepository.updateDocument(id, {
      title: dto.title,
      source: dto.source,
      contentType: dto.contentType,
      content: dto.content,
      metadata: dto.metadata as never,
    } as never);
  }

  async softDeleteDocument(id: string): Promise<KnowledgeDocument> {
    await this.findDocumentById(id);
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
}
