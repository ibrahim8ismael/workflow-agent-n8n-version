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

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Run> {
    return this.runsService.findById(id);
  }
}
