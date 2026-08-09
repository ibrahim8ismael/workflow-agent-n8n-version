import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_MAX_CONTENT_BYTES } from '../constants/knowledge.constants';
import { KnowledgeRepository } from '../repositories/knowledge.repository';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  const doc = (overrides: Record<string, unknown> = {}) => ({
    id: 'doc-1',
    title: 'Revenue Report',
    source: 'upload',
    contentType: 'markdown',
    content: 'Q2 numbers',
    ...overrides,
  });

  const mockRepo = {
    createDocument: vi.fn(),
    findDocumentById: vi.fn(),
    findDocuments: vi.fn(),
    searchChunks: vi.fn(),
    findChunksByDocumentId: vi.fn(),
    createChunks: vi.fn(),
    updateDocument: vi.fn(),
    softDeleteDocument: vi.fn(),
    deleteChunksByDocumentId: vi.fn(),
    countDocuments: vi.fn(),
  } as unknown as KnowledgeRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.createDocument).mockResolvedValue(doc() as never);
    vi.mocked(mockRepo.findDocumentById).mockResolvedValue(doc() as never);
    vi.mocked(mockRepo.findDocuments).mockResolvedValue([doc()] as never);
    vi.mocked(mockRepo.searchChunks).mockResolvedValue([{ id: 'chunk-1', content: 'x' }] as never);
    vi.mocked(mockRepo.findChunksByDocumentId).mockResolvedValue([{ id: 'chunk-1' }] as never);
    vi.mocked(mockRepo.createChunks).mockResolvedValue(undefined as never);
    vi.mocked(mockRepo.updateDocument).mockResolvedValue(doc() as never);
    vi.mocked(mockRepo.softDeleteDocument).mockResolvedValue(doc() as never);
    vi.mocked(mockRepo.deleteChunksByDocumentId).mockResolvedValue(undefined as never);
    vi.mocked(mockRepo.countDocuments).mockResolvedValue(3 as never);
    service = new KnowledgeService(mockRepo);
  });

  describe('createDocument', () => {
    it('should create a document and connect the organization when provided', async () => {
      await service.createDocument({
        title: 'Doc',
        content: 'x',
        organizationId: 'org-1',
        contentType: 'markdown',
      });

      expect(mockRepo.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Doc',
          organization: { connect: { id: 'org-1' } },
        }),
      );
    });

    it('should connect a document to a personal user when provided', async () => {
      await service.createDocument({
        title: 'Personal notes',
        content: 'x',
        userId: 'user-1',
        contentType: 'markdown',
      });

      expect(mockRepo.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ user: { connect: { id: 'user-1' } } }),
      );
    });
  });

  describe('findDocumentById / findDocuments', () => {
    it('should return the document when found', async () => {
      const result = await service.findDocumentById('doc-1');

      expect(result.id).toBe('doc-1');
    });

    it('should throw when the document is missing', async () => {
      vi.mocked(mockRepo.findDocumentById).mockResolvedValue(null);

      await expect(service.findDocumentById('missing')).rejects.toThrow(NotFoundException);
    });

    it('should filter documents by organization', async () => {
      await service.findDocuments({ organizationId: 'org-1', skip: 1, take: 5 });

      expect(mockRepo.findDocuments).toHaveBeenCalledWith({
        where: { OR: [{ organizationId: 'org-1' }] },
        orderBy: { createdAt: 'desc' },
        skip: 1,
        take: 5,
      });
    });

    it('should pass undefined where without an organization', async () => {
      await service.findDocuments();

      expect(mockRepo.findDocuments).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        skip: undefined,
        take: undefined,
      });
    });
  });

  describe('search', () => {
    it('should delegate the search to the repository', async () => {
      await service.search({ organizationId: 'org-1', query: 'revenue', limit: 5, offset: 0 });

      expect(mockRepo.searchChunks).toHaveBeenCalledWith(
        { userId: undefined, organizationId: 'org-1' },
        'revenue',
        {
          category: undefined,
          limit: 5,
          offset: 0,
        },
      );
    });
  });

  describe('getDocumentChunks', () => {
    it('should return chunks for an existing document', async () => {
      const result = await service.getDocumentChunks('doc-1');

      expect(mockRepo.findChunksByDocumentId).toHaveBeenCalledWith('doc-1');
      expect(result).toEqual([{ id: 'chunk-1' }]);
    });

    it('should scope chunks to the organization when provided', async () => {
      await service.getDocumentChunks('doc-1', { organizationId: 'org-1' });

      expect(mockRepo.findDocumentById).toHaveBeenCalledWith('doc-1', { organizationId: 'org-1' });
      expect(mockRepo.findChunksByDocumentId).toHaveBeenCalledWith('doc-1', {
        organizationId: 'org-1',
      });
    });

    it('should throw when the document is missing', async () => {
      vi.mocked(mockRepo.findDocumentById).mockResolvedValue(null);

      await expect(service.getDocumentChunks('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('ingestDocument', () => {
    it('rejects non-Markdown documents', async () => {
      await expect(
        service.ingestDocument({ title: 'Doc', contentType: 'text' } as never, 'content'),
      ).rejects.toThrow('contentType "markdown"');
    });

    it('rejects empty Markdown content', async () => {
      await expect(
        service.ingestDocument({ title: 'Doc', contentType: 'markdown' }, '  '),
      ).rejects.toThrow('Markdown content cannot be empty');
    });

    it('rejects Markdown content above the size limit', async () => {
      const oversizedContent = 'x'.repeat(KNOWLEDGE_MAX_CONTENT_BYTES + 1);

      await expect(
        service.ingestDocument({ title: 'Doc', contentType: 'markdown' }, oversizedContent),
      ).rejects.toThrow('5 MB');
    });

    it('should create chunks for long content', async () => {
      const longContent = 'x'.repeat(2500);
      vi.mocked(mockRepo.createDocument).mockResolvedValue(doc({ content: longContent }) as never);

      await service.ingestDocument(
        { title: 'Doc', content: longContent, contentType: 'markdown' },
        longContent,
      );

      expect(mockRepo.createChunks).toHaveBeenCalled();
      const chunks = vi.mocked(mockRepo.createChunks).mock.calls[0][0] as Array<{
        chunkIndex: number;
        content: string;
        knowledgeDocumentId: string;
      }>;
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toMatchObject({
        knowledgeDocumentId: 'doc-1',
        chunkIndex: 0,
        metadata: { source: undefined, title: 'Doc' },
      });
    });

    it('should create a single chunk for short content', async () => {
      await service.ingestDocument(
        { title: 'Doc', content: 'short', contentType: 'markdown' },
        'short',
      );

      expect(mockRepo.createChunks).toHaveBeenCalledWith([
        expect.objectContaining({ content: 'short', chunkIndex: 0 }),
      ]);
    });
  });

  describe('updateDocument / softDeleteDocument / countDocuments', () => {
    it('should update an existing document', async () => {
      await service.updateDocument('doc-1', { title: 'Updated' });

      expect(mockRepo.updateDocument).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ title: 'Updated' }),
      );
    });

    it('should replace chunks when Markdown content is updated', async () => {
      await service.updateDocument('doc-1', {
        title: 'Updated pricing',
        content: '# New pricing\nPremium costs $25.',
        source: 'pricing.md',
      });

      expect(mockRepo.deleteChunksByDocumentId).toHaveBeenCalledWith('doc-1');
      expect(mockRepo.createChunks).toHaveBeenCalledWith([
        {
          knowledgeDocumentId: 'doc-1',
          content: '# New pricing\nPremium costs $25.',
          chunkIndex: 0,
          metadata: { source: 'pricing.md', title: 'Updated pricing' },
        },
      ]);
    });

    it('rejects empty or oversized Markdown edits', async () => {
      await expect(service.updateDocument('doc-1', { content: '   ' })).rejects.toThrow(
        'Markdown content cannot be empty',
      );

      await expect(
        service.updateDocument('doc-1', {
          content: 'x'.repeat(KNOWLEDGE_MAX_CONTENT_BYTES + 1),
        }),
      ).rejects.toThrow('5 MB');
    });

    it('should delete chunks before soft deleting a document', async () => {
      await service.softDeleteDocument('doc-1');

      expect(mockRepo.deleteChunksByDocumentId).toHaveBeenCalledWith('doc-1');
      expect(mockRepo.softDeleteDocument).toHaveBeenCalledWith('doc-1');
    });

    it('should count documents scoped to an organization', async () => {
      const count = await service.countDocuments('org-1');

      expect(mockRepo.countDocuments).toHaveBeenCalledWith({ organizationId: 'org-1' });
      expect(count).toBe(3);
    });

    it('should count all documents without a scope', async () => {
      await service.countDocuments();

      expect(mockRepo.countDocuments).toHaveBeenCalledWith(undefined);
    });
  });
});
