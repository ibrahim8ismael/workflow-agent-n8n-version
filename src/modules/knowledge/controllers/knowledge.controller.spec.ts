import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from '../services/knowledge.service';
import { KnowledgeController, markdownFileFilter } from './knowledge.controller';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;

  const mockService = {
    ingestDocument: vi.fn(),
  } as unknown as KnowledgeService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockService.ingestDocument).mockResolvedValue({ id: 'doc-1' } as never);
    controller = new KnowledgeController(mockService);
  });

  describe('upload', () => {
    it('ingests a Markdown file using its filename as the source', async () => {
      const file = {
        originalname: 'pricing.md',
        buffer: Buffer.from('# Pricing\nPremium costs $20.'),
      } as Express.Multer.File;

      await controller.upload(file, { organizationId: 'org-1' });

      expect(mockService.ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'pricing',
          source: 'pricing.md',
          contentType: 'markdown',
          organizationId: 'org-1',
        }),
        '# Pricing\nPremium costs $20.',
      );
    });

    it('requires a file', async () => {
      await expect(controller.upload(undefined as never, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('markdownFileFilter', () => {
    it('accepts only files ending in .md', () => {
      const callback = vi.fn();

      markdownFileFilter(
        {} as Express.Request,
        { originalname: 'guide.MD' } as Express.Multer.File,
        callback,
      );
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects non-Markdown files', () => {
      const callback = vi.fn();

      markdownFileFilter(
        {} as Express.Request,
        { originalname: 'guide.txt' } as Express.Multer.File,
        callback,
      );
      expect(callback).toHaveBeenCalledWith(expect.any(BadRequestException), false);
    });
  });
});
