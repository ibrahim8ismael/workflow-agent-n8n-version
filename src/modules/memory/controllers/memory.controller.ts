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
import { Memory } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type CreateMemoryDto, createMemorySchema } from '../dto/create-memory.dto';
import { type UpdateMemoryDto, updateMemorySchema } from '../dto/update-memory.dto';
import { MemoryService } from '../services/memory.service';

@Controller('memory')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  async create(@Body() dto: CreateMemoryDto, @CurrentUser() user: MemoryUser): Promise<Memory> {
    const parsed = createMemorySchema.parse(dto);
    return this.memoryService.create({
      ...parsed,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    });
  }

  @Get('agent/:agentId')
  async findByAgent(
    @Param('agentId') agentId: string,
    @CurrentUser() user: MemoryUser,
    @Query('type') type?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Memory[]> {
    return this.memoryService.findByAgent(agentId, {
      type,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('agent/:agentId/search')
  async searchByAgent(
    @Param('agentId') agentId: string,
    @CurrentUser() user: MemoryUser,
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<Memory[]> {
    return this.memoryService.searchByAgent(agentId, query, {
      type,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: MemoryUser): Promise<Memory> {
    return this.memoryService.findById(id, this.scopeFor(user));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
    @CurrentUser() user: MemoryUser,
  ): Promise<Memory> {
    const parsed = updateMemorySchema.parse(dto);
    return this.memoryService.update(id, parsed, this.scopeFor(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: MemoryUser): Promise<Memory> {
    return this.memoryService.softDelete(id, this.scopeFor(user));
  }

  private scopeFor(user: MemoryUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type MemoryUser = { id: string; activeContext?: string; organizationId?: string };
