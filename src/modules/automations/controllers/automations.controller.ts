import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { createAutomationFromBlueprintSchema } from '../dto/automation.dto';
import { AutomationsService } from '../services/automations.service';

@Controller('automations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: ControllerUser) {
    const dto = createAutomationFromBlueprintSchema.parse(body);
    return this.automations.createFromBlueprint(dto, this.scope(user));
  }

  @Get()
  async list(@CurrentUser() user: ControllerUser) {
    return this.automations.list(this.scope(user));
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.automations.findById(id, this.scope(user));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approve(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.automations.approve(id, this.scope(user));
  }

  @Post(':id/reprovision')
  @HttpCode(HttpStatus.ACCEPTED)
  async reprovision(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.automations.reprovision(id, this.scope(user));
  }

  @Post(':id/readiness/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshReadiness(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.automations.refreshReadiness(id, this.scope(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.automations.softDelete(id, this.scope(user));
  }

  /** Acting context: never trusts body-provided org IDs. */
  private scope(user: ControllerUser): { userId?: string; organizationId?: string } {
    if (user.activeContext === 'organization' && user.organizationId) {
      return { userId: user.id, organizationId: user.organizationId };
    }
    return { userId: user.id };
  }
}

type ControllerUser = { id: string; activeContext?: string; organizationId?: string };
