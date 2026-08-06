import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Run } from '@prisma/client';
import { RunsService } from '../runs/runs.service';
import { type ExecuteRunDto, executeRunSchema } from './dto/execute-run.dto';
import { RuntimeService } from './services/runtime.service';

@Controller('runs')
export class RuntimeController {
  constructor(
    private readonly runtimeService: RuntimeService,
    private readonly runsService: RunsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async execute(@Body() dto: ExecuteRunDto) {
    const parsed = executeRunSchema.parse(dto);
    return this.runtimeService.execute(parsed);
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
