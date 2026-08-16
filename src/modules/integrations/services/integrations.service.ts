import { Injectable, NotFoundException } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { CreateIntegrationDto } from '../dto/create-integration.dto';
import { IntegrationsRepository } from '../repositories/integrations.repository';

@Injectable()
export class IntegrationsService {
  constructor(private readonly integrationsRepository: IntegrationsRepository) {}

  async create(
    dto: CreateIntegrationDto,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Integration> {
    const userId = scope?.userId;
    const organizationId = scope?.organizationId ?? dto.organizationId;

    return this.integrationsRepository.create({
      name: dto.name,
      category: dto.category as never,
      provider: dto.provider,
      config: dto.config as never,
      status: 'DISCONNECTED',
      ...(userId ? { user: { connect: { id: userId } } } : {}),
      ...(organizationId ? { organization: { connect: { id: organizationId } } } : {}),
    } as never);
  }

  async findById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Integration> {
    const integration = await this.integrationsRepository.findById(id, scope);
    if (!integration) throw new NotFoundException(`Integration with id "${id}" not found`);
    return integration;
  }

  async findByOrganization(
    organizationId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Integration[]> {
    if (scope?.organizationId && scope.organizationId !== organizationId) {
      return [];
    }
    return this.integrationsRepository.findByOrganization(organizationId);
  }

  async isConnected(organizationId: string, provider: string): Promise<boolean> {
    return this.integrationsRepository.checkAvailability(organizationId, provider);
  }

  async softDelete(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Integration> {
    await this.findById(id, scope);
    return this.integrationsRepository.softDelete(id);
  }
}
