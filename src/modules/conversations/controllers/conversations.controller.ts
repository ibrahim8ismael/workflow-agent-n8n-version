import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { Conversation, Message } from '@prisma/client';
import type { ConversationsService } from '../services/conversations.service';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async create(
    @Body() dto: {
      title?: string;
      agentId: string;
      userId?: string;
      organizationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Conversation> {
    return this.conversationsService.create(dto);
  }

  @Get()
  async findMany(
    @Query('agentId') agentId?: string,
    @Query('userId') userId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Conversation[]> {
    return this.conversationsService.findMany({
      agentId,
      userId,
      organizationId,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Conversation> {
    return this.conversationsService.findById(id);
  }

  @Post(':id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() message: { role: string; content: string; metadata?: Record<string, unknown> },
  ): Promise<Message> {
    return this.conversationsService.addMessage(id, message);
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Message[]> {
    return this.conversationsService.getMessages(id, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string): Promise<Conversation> {
    return this.conversationsService.resolve(id);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<Conversation> {
    return this.conversationsService.archive(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Conversation> {
    return this.conversationsService.softDelete(id);
  }
}
