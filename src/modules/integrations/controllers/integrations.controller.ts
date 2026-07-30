import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { Integration } from '@prisma/client';
import type { IntegrationsService } from '../services/integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post()
  async create(
    @Body() dto: {
      name: string;
      category: string;
      provider: string;
      config?: Record<string, unknown>;
      organizationId?: string;
    },
  ): Promise<Integration> {
    return this.integrationsService.create(dto as never);
  }

  @Get('organization/:organizationId')
  async findByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<Integration[]> {
    return this.integrationsService.findByOrganization(organizationId);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Integration> {
    return this.integrationsService.findById(id);
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
  async remove(@Param('id') id: string): Promise<Integration> {
    return this.integrationsService.softDelete(id);
  }
}
