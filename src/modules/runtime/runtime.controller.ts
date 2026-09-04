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
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ConversationsService } from '../conversations/services/conversations.service';
import { RunsService } from '../runs/runs.service';
import {
  type ConfirmAutomationDesignDto,
  confirmAutomationDesignSchema,
} from './dto/confirm-automation-design.dto';
import { type ExecuteRunDto, executeRunSchema } from './dto/execute-run.dto';
import { JaafarRuntimeService } from './services/jaafar-runtime.service';
import { RuntimeMode } from './types/runtime.types';

@Controller('runs')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class RuntimeController {
  constructor(
    private readonly jaafarRuntime: JaafarRuntimeService,
    private readonly runsService: RunsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async execute(@Body() dto: ExecuteRunDto, @CurrentUser() user: RuntimeUser) {
    const parsed = executeRunSchema.parse(dto);
    const request = await this.ensureConversation(this.withUserScope(parsed, user));
    const result = await this.jaafarRuntime.start(request);
    return { ...result, conversationId: request.conversationId };
  }

  @Post('stream')
  async stream(
    @Body() dto: ExecuteRunDto,
    @CurrentUser() user: RuntimeUser,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = executeRunSchema.parse(dto);
    if (parsed.mode !== RuntimeMode.CONVERSATION && parsed.mode !== RuntimeMode.EXECUTION) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: 'Streaming is supported for conversation and execution modes',
      });
      return;
    }
    const request = await this.ensureConversation(this.withUserScope(parsed, user));

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    let activeRunId: string | undefined;
    let terminal = false;
    const cancelOnDisconnect = () => {
      if (!terminal && activeRunId) {
        void this.jaafarRuntime.cancel(activeRunId, this.scope(user));
      }
    };
    response.once('close', cancelOnDisconnect);

    try {
      for await (const event of this.jaafarRuntime.stream(request)) {
        activeRunId = event.runId;
        terminal =
          event.type === 'run.completed' ||
          event.type === 'run.waiting' ||
          event.type === 'run.failed' ||
          event.type === 'run.cancelled';
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      response.off('close', cancelOnDisconnect);
      response.end();
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approve(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    await this.assertRunAccess(id, user);
    return this.jaafarRuntime.approve(id, { approved: true }, this.scope(user));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: RuntimeUser,
  ) {
    await this.assertRunAccess(id, user);
    return this.jaafarRuntime.reject(id, body?.reason, this.scope(user));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmAutomationDesignDto,
    @CurrentUser() user: RuntimeUser,
  ) {
    const run = await this.assertRunAccess(id, user);
    const confirmation = confirmAutomationDesignSchema.parse(dto);
    return this.jaafarRuntime.confirmAutomationDesign(
      run.id,
      {
        userId: user.id,
        organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
      },
      confirmation,
    );
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    const run = await this.assertRunAccess(id, user);
    return run;
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

  private scope(user: RuntimeUser) {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }

  private async assertRunAccess(id: string, user: RuntimeUser) {
    const run = await this.runsService.findByIdOrConversation(id);
    const personalAccess = !run.userId || run.userId === user.id;
    const organizationAccess =
      user.activeContext === 'organization' &&
      Boolean(user.organizationId) &&
      run.organizationId === user.organizationId;
    if (!personalAccess && !organizationAccess) {
      throw new NotFoundException(`Run with id "${id}" not found`);
    }
    return run;
  }
}

type RuntimeUser = {
  id: string;
  activeContext?: string;
  organizationId?: string;
};
