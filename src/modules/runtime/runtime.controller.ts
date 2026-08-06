import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Run } from '@prisma/client';
import type { Response } from 'express';
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
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async execute(@Body() dto: ExecuteRunDto) {
    const parsed = executeRunSchema.parse(dto);
    if (!parsed.mode) parsed.mode = RuntimeMode.CONVERSATION;
    return this.runtimeRouter.run(parsed);
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

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    try {
      for await (const event of this.runtimeRouter.stream(parsed)) {
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

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Run> {
    return this.runsService.findById(id);
  }
}
