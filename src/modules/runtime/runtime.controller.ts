import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Run } from '@prisma/client';
import type { Response } from 'express';
import { ConversationsService } from '../conversations/services/conversations.service';
import { RunsService } from '../runs/runs.service';
import { type ExecuteRunDto, executeRunSchema } from './dto/execute-run.dto';
import { RuntimeRouterService } from './runtime-router.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeMode } from './types/runtime.types';

@Controller('runs')
export class RuntimeController {
  constructor(
    private readonly runtimeService: RuntimeService,
    private readonly runtimeRouter: RuntimeRouterService,
    private readonly runsService: RunsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async execute(@Body() dto: ExecuteRunDto) {
    const parsed = executeRunSchema.parse(dto);
    const request = await this.ensureConversation(parsed);
    const result = await this.runtimeRouter.run(request);
    return { ...result, conversationId: request.conversationId };
  }

  @Post('stream')
  async stream(@Body() dto: ExecuteRunDto, @Res() response: Response): Promise<void> {
    const parsed = executeRunSchema.parse(dto);
    if (parsed.mode !== RuntimeMode.CONVERSATION) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: 'Streaming is currently supported only for conversation mode',
      });
      return;
    }
    const request = await this.ensureConversation(parsed);

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
  async approve(@Param('id') id: string) {
    return this.runtimeService.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  async reject(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.runtimeService.reject(id, body?.reason);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  async confirm(@Param('id') id: string) {
    return this.runtimeRouter.confirmEmployeeDesign(id);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Run> {
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
}
