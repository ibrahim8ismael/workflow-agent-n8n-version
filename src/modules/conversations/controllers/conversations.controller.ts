import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Conversation, Message } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { ConversationsService } from '../services/conversations.service';

@Controller('conversations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async create(
    @Body() dto: {
      title?: string;
      agentId: string;
      metadata?: Record<string, unknown>;
    },
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.create({
      ...dto,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    });
  }

  @Get()
  async findMany(
    @CurrentUser() user: ConversationUser,
    @Query('agentId') agentId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Conversation[]> {
    return this.conversationsService.findMany({
      agentId,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.findById(id, this.scopeFor(user));
  }

  @Post(':id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() message: { role: string; content: string; metadata?: Record<string, unknown> },
    @CurrentUser() user: ConversationUser,
  ): Promise<Message> {
    return this.conversationsService.addMessage(id, message, this.scopeFor(user));
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: ConversationUser,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Message[]> {
    return this.conversationsService.getMessages(
      id,
      {
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      this.scopeFor(user),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string },
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.updateTitle(id, body.title ?? '', this.scopeFor(user));
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.resolve(id, this.scopeFor(user));
  }

  @Post(':id/archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.archive(id, this.scopeFor(user));
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: ConversationUser,
  ): Promise<Conversation> {
    return this.conversationsService.softDelete(id, this.scopeFor(user));
  }

  private scopeFor(user: ConversationUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type ConversationUser = { id: string; activeContext?: string; organizationId?: string };
