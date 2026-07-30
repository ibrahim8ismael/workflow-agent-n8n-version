import { Injectable, NotFoundException } from '@nestjs/common';
import type { Integration } from '@prisma/client';
import type { CreateIntegrationDto } from '../dto/create-integration.dto';
import type { IntegrationsRepository } from '../repositories/integrations.repository';

@Injectable()
export class IntegrationsService {
  constructor(private readonly integrationsRepository: IntegrationsRepository) {}

  async create(dto: CreateIntegrationDto): Promise<Integration> {
    return this.integrationsRepository.create({
      name: dto.name,
      category: dto.category as never,
      provider: dto.provider,
      config: dto.config as never,
      status: 'DISCONNECTED',
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
    } as never);
  }

  async findById(id: string): Promise<Integration> {
    const integration = await this.integrationsRepository.findById(id);
    if (!integration) throw new NotFoundException(`Integration with id "${id}" not found`);
    return integration;
  }

  async findByOrganization(organizationId: string): Promise<Integration[]> {
    return this.integrationsRepository.findByOrganization(organizationId);
  }

  async isConnected(organizationId: string, provider: string): Promise<boolean> {
    return this.integrationsRepository.checkAvailability(organizationId, provider);
  }

  async softDelete(id: string): Promise<Integration> {
    await this.findById(id);
    return this.integrationsRepository.softDelete(id);
  }
}
