import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ConversationsService } from '../conversations/services/conversations.service';
import { RunsService } from '../runs/runs.service';
import { type ExecuteRunDto, executeRunSchema } from './dto/execute-run.dto';
import { AgentRunTraceService } from './services/agent-run-trace.service';
import { JaafarQualityMetricsService } from './services/jaafar-quality-metrics.service';
import { JaafarRuntimeService } from './services/jaafar-runtime.service';
import { runtimeUserErrorMessage } from './shared/runtime-user-message';
import { RuntimeMode } from './types/runtime.types';

@Controller('runs')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class RuntimeController {
  constructor(
    private readonly jaafarRuntime: JaafarRuntimeService,
    private readonly runsService: RunsService,
    private readonly conversationsService: ConversationsService,
    private readonly traceService: AgentRunTraceService,
    private readonly metricsService: JaafarQualityMetricsService,
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

    const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();
    let activeRunId: string | undefined;
    let terminal = false;
    // Flaky connections must not kill the run instantly — give the client a
    // grace window to reconnect before cancelling.
    const cancelOnDisconnect = () => {
      if (!terminal && activeRunId) {
        const runId = activeRunId;
        disconnectGraceTimers.set(
          runId,
          setTimeout(async () => {
            disconnectGraceTimers.delete(runId);
            try {
              const run = await this.runsService.findById(runId);
              if (!['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(run.status)) {
                await this.jaafarRuntime.cancel(runId, this.scope(user));
              }
            } catch {
              /* run already terminal or gone */
            }
          }, 10_000),
        );
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
        if (terminal) {
          const timer = disconnectGraceTimers.get(event.runId);
          if (timer) clearTimeout(timer);
          disconnectGraceTimers.delete(event.runId);
        }
        if (event.type === 'run.failed') {
          // The client only renders token/run.completed payloads — surface a
          // human message as a token so failures are never a silent freeze.
          response.write(
            `event: token\ndata: ${JSON.stringify({
              type: 'token',
              runId: event.runId,
              content: runtimeUserErrorMessage(failureMessage(event)),
            })}\n\n`,
          );
        }
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

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    await this.assertRunAccess(id, user);
    return this.jaafarRuntime.retryAutomation(id, this.scope(user));
  }

  @Get(':id/trace')
  async trace(@Param('id') id: string, @CurrentUser() user: RuntimeUser) {
    const run = await this.assertRunAccess(id, user);
    return this.traceService.trace(run.id);
  }

  @Get('metrics/summary')
  async metricsSummary(
    @Query('since') since: string | undefined,
    @Query('agentId') agentId: string | undefined,
    @CurrentUser() user: RuntimeUser,
  ) {
    return this.metricsService.metrics({
      ...(since ? { since: new Date(since) } : {}),
      ...(user.activeContext === 'organization' && user.organizationId
        ? { organizationId: user.organizationId }
        : {}),
      ...(agentId ? { agentId } : {}),
    });
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

type RuntimeStreamEvent = {
  type: string;
  runId: string;
  payload?: { error?: { message?: string } };
  message?: string;
};

function failureMessage(event: RuntimeStreamEvent): string {
  return event.payload?.error?.message ?? event.message ?? 'Run failed';
}
