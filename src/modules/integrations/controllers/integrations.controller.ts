import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { IntegrationsService } from '../services/integrations.service';

@Controller('integrations')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post()
  async create(
    @Body()
    dto: {
      name: string;
      category: string;
      provider: string;
      config?: Record<string, unknown>;
      organizationId?: string;
    },
    @CurrentUser() user: IntegrationUser,
  ): Promise<Integration> {
    return this.integrationsService.create(dto as never, this.scopeFor(user));
  }

  @Get('organization/:organizationId')
  async findByOrganization(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: IntegrationUser,
  ): Promise<Integration[]> {
    return this.integrationsService.findByOrganization(organizationId, this.scopeFor(user));
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: IntegrationUser,
  ): Promise<Integration> {
    return this.integrationsService.findById(id, this.scopeFor(user));
  }

  @Get(':organizationId/check/:provider')
  async checkConnection(
    @Param('organizationId') organizationId: string,
    @Param('provider') provider: string,
  ): Promise<{ connected: boolean }> {
    const connected = await this.integrationsService.isConnected(organizationId, provider);
    return { connected };
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: IntegrationUser,
  ): Promise<Integration> {
    return this.integrationsService.softDelete(id, this.scopeFor(user));
  }

  private scopeFor(user: IntegrationUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type IntegrationUser = { id: string; activeContext?: string; organizationId?: string };
