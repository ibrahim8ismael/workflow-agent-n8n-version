import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Run } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ConversationsService } from '../conversations/services/conversations.service';
import { RunsService } from '../runs/runs.service';
import { type ExecuteRunDto, executeRunSchema } from './dto/execute-run.dto';
import { RuntimeRouterService } from './runtime-router.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeMode } from './types/runtime.types';

@Controller('runs')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class RuntimeController {
  constructor(
    private readonly runtimeService: RuntimeService,
    private readonly runtimeRouter: RuntimeRouterService,
    private readonly runsService: RunsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async execute(@Body() dto: ExecuteRunDto, @CurrentUser() user: RuntimeUser) {
    const parsed = executeRunSchema.parse(dto);
    const request = await this.ensureConversation(this.withUserScope(parsed, user));
    const result = await this.runtimeRouter.run(request);
    return { ...result, conversationId: request.conversationId };
  }

  @Post('stream')
  async stream(
    @Body() dto: ExecuteRunDto,
    @CurrentUser() user: RuntimeUser,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = executeRunSchema.parse(dto);
    if (parsed.mode !== RuntimeMode.CONVERSATION) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: 'Streaming is currently supported only for conversation mode',
      });
      return;
    }
    const request = await this.ensureConversation(this.withUserScope(parsed, user));

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    try {
      for await (const event of this.runtimeRouter.stream(request)) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      response.end();
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approve(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    await this.assertRunAccess(id, user);
    return this.runtimeService.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: RuntimeUser,
  ) {
    await this.assertRunAccess(id, user);
    return this.runtimeService.reject(id, body?.reason);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  async confirm(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    await this.assertRunAccess(id, user);
    return this.runtimeRouter.confirmEmployeeDesign(id);
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: RuntimeUser): Promise<Run> {
    await this.assertRunAccess(id, user);
    return this.runsService.findById(id);
  }

  private async ensureConversation(request: ExecuteRunDto): Promise<ExecuteRunDto> {
    if (request.conversationId) return request;

    const conversation = await this.conversationsService.create({
      agentId: request.agentId,
      title: 'New chat',
      userId: request.userId,
      organizationId: request.organizationId,
    });
    return { ...request, conversationId: conversation.id };
  }

  private withUserScope(request: ExecuteRunDto, user: RuntimeUser): ExecuteRunDto {
    return {
      ...request,
      userId: user.id,
      ...(user.activeContext === 'organization' && user.organizationId
        ? { organizationId: user.organizationId }
        : { organizationId: undefined }),
    };
  }

  private async assertRunAccess(id: string, user: RuntimeUser): Promise<void> {
    const run = await this.runsService.findById(id);
    const personalAccess = run.userId === user.id;
    const organizationAccess =
      user.activeContext === 'organization' &&
      Boolean(user.organizationId) &&
      run.organizationId === user.organizationId;
    if (!personalAccess && !organizationAccess) {
      throw new NotFoundException(`Run with id "${id}" not found`);
    }
  }
}

type RuntimeUser = {
  id: string;
  activeContext?: string;
  organizationId?: string;
};
