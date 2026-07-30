import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { KnowledgeDocument, KnowledgeDocumentChunk } from '@prisma/client';
import {
  type CreateKnowledgeDocumentDto,
  createKnowledgeDocumentSchema,
} from '../dto/create-knowledge.dto';
import { type SearchKnowledgeDto, searchKnowledgeSchema } from '../dto/search-knowledge.dto';
import type { KnowledgeService } from '../services/knowledge.service';

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
    return this.knowledgeService.ingestDocument(parsed, content);
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
