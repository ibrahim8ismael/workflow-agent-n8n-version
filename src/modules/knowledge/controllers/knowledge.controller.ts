import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeDocument, KnowledgeDocumentChunk } from '@prisma/client';
import type { Express } from 'express';
import { KNOWLEDGE_MAX_CONTENT_BYTES } from '../constants/knowledge.constants';
import {
  type CreateKnowledgeDocumentDto,
  createKnowledgeDocumentSchema,
} from '../dto/create-knowledge.dto';
import { type SearchKnowledgeDto, searchKnowledgeSchema } from '../dto/search-knowledge.dto';
import { KnowledgeService } from '../services/knowledge.service';

export const markdownFileFilter = (
  _request: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void => {
  if (!file.originalname.toLowerCase().endsWith('.md')) {
    callback(new BadRequestException('Only .md Markdown files are supported'), false);
    return;
  }
  callback(null, true);
};

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async create(@Body() dto: CreateKnowledgeDocumentDto): Promise<KnowledgeDocument> {
    const parsed = createKnowledgeDocumentSchema.parse(dto);
    return this.knowledgeService.createDocument(parsed);
  }

  @Post('ingest')
  async ingest(
    @Body() body: CreateKnowledgeDocumentDto & { content: string },
  ): Promise<KnowledgeDocument> {
    const { content, ...docDto } = body;
    const parsed = createKnowledgeDocumentSchema.parse(docDto);
    if (typeof content !== 'string' || !content.trim()) {
      throw new BadRequestException('Markdown content cannot be empty');
    }
    return this.knowledgeService.ingestDocument(parsed, content);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: KNOWLEDGE_MAX_CONTENT_BYTES },
      fileFilter: markdownFileFilter,
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Omit<CreateKnowledgeDocumentDto, 'title' | 'source' | 'contentType'> & {
      title?: string;
    },
  ): Promise<KnowledgeDocument> {
    if (!file) {
      throw new BadRequestException('A Markdown file is required in the "file" field');
    }

    const parsed = createKnowledgeDocumentSchema.parse({
      ...body,
      title: body.title?.trim() || file.originalname.replace(/\.md$/i, ''),
      source: file.originalname,
      contentType: 'markdown',
    });

    return this.knowledgeService.ingestDocument(parsed, file.buffer.toString('utf8'));
  }

  @Get()
  async findMany(
    @Query('organizationId') organizationId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<KnowledgeDocument[]> {
    return this.knowledgeService.findDocuments({
      organizationId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('search')
  async search(@Query() query: SearchKnowledgeDto): Promise<KnowledgeDocumentChunk[]> {
    const parsed = searchKnowledgeSchema.parse(query);
    return this.knowledgeService.search(parsed);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<KnowledgeDocument> {
    return this.knowledgeService.findDocumentById(id);
  }

  @Get(':id/chunks')
  async getChunks(@Param('id') id: string): Promise<KnowledgeDocumentChunk[]> {
    return this.knowledgeService.getDocumentChunks(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateKnowledgeDocumentDto>,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeService.updateDocument(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<KnowledgeDocument> {
    return this.knowledgeService.softDeleteDocument(id);
  }
}
