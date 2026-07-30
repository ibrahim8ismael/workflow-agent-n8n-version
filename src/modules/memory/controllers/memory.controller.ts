import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Memory } from '@prisma/client';
import { type CreateMemoryDto, createMemorySchema } from '../dto/create-memory.dto';
import { type UpdateMemoryDto, updateMemorySchema } from '../dto/update-memory.dto';
import type { MemoryService } from '../services/memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async create(@Body() dto: CreateMemoryDto): Promise<Memory> {
    const parsed = createMemorySchema.parse(dto);
    return this.memoryService.create(parsed);
  }

  @Get('agent/:agentId')
  async findByAgent(
    @Param('agentId') agentId: string,
    @Query('type') type?: string,
    @Query('userId') userId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Memory[]> {
    return this.memoryService.findByAgent(agentId, {
      type,
      userId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('agent/:agentId/search')
  async searchByAgent(
    @Param('agentId') agentId: string,
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<Memory[]> {
    return this.memoryService.searchByAgent(agentId, query, {
      type,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Memory> {
    return this.memoryService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateMemoryDto): Promise<Memory> {
    const parsed = updateMemorySchema.parse(dto);
    return this.memoryService.update(id, parsed);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Memory> {
    return this.memoryService.softDelete(id);
  }
}
