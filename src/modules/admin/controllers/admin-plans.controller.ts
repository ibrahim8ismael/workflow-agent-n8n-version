import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import {
  type PlanCreateDto,
  type PlanUpdateDto,
  planCreateSchema,
  planUpdateSchema,
} from '../dto/admin-plan-update.dto';
import { SystemAdminGuard } from '../guards/system-admin.guard';

@Controller('admin/plans')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminPlansController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll() {
    return this.db.subscriptionPlan.findMany({
      where: { deletedAt: null },
      orderBy: { price: 'asc' },
      include: { quota: true },
    });
  }

  @Post()
  async create(@Body() dto: PlanCreateDto) {
    const data = planCreateSchema.parse(dto);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.subscriptionPlan.create({ data: data as any });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: PlanUpdateDto) {
    const data = planUpdateSchema.parse(dto);
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.subscriptionPlan.update({ where: { id }, data: data as any });
  }
}
