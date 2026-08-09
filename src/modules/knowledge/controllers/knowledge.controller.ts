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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeDocument, KnowledgeDocumentChunk } from '@prisma/client';
import type { Express } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
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
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async create(
    @Body() dto: CreateKnowledgeDocumentDto,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocument> {
    const parsed = createKnowledgeDocumentSchema.parse(dto);
    return this.knowledgeService.createDocument({ ...parsed, ...this.scopeFor(user) });
  }

  @Post('ingest')
  async ingest(
    @Body() body: CreateKnowledgeDocumentDto & { content: string },
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocument> {
    const { content, ...docDto } = body;
    const parsed = createKnowledgeDocumentSchema.parse(docDto);
    if (typeof content !== 'string' || !content.trim()) {
      throw new BadRequestException('Markdown content cannot be empty');
    }
    return this.knowledgeService.ingestDocument({ ...parsed, ...this.scopeFor(user) }, content);
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
    @CurrentUser() user: KnowledgeUser,
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

    return this.knowledgeService.ingestDocument(
      { ...parsed, ...this.scopeFor(user) },
      file.buffer.toString('utf8'),
    );
  }

  @Get()
  async findMany(
    @CurrentUser() user: KnowledgeUser,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<KnowledgeDocument[]> {
    return this.knowledgeService.findDocuments({
      userId: user.id,
      ...(user.activeContext === 'organization' && user.organizationId
        ? { organizationId: user.organizationId }
        : {}),
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('search')
  async search(
    @Query() query: SearchKnowledgeDto,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocumentChunk[]> {
    const parsed = searchKnowledgeSchema.parse(query);
    return this.knowledgeService.search({
      ...parsed,
      ...this.scopeFor(user),
    });
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeService.findDocumentById(id, this.scopeFor(user));
  }

  @Get(':id/chunks')
  async getChunks(
    @Param('id') id: string,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocumentChunk[]> {
    return this.knowledgeService.getDocumentChunks(id, this.scopeFor(user));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateKnowledgeDocumentDto>,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeService.updateDocument(id, dto, this.scopeFor(user));
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: KnowledgeUser,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeService.softDeleteDocument(id, this.scopeFor(user));
  }

  private scopeFor(user: KnowledgeUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type KnowledgeUser = {
  id: string;
  activeContext?: string;
  organizationId?: string;
};
