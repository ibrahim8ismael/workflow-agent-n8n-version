import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../modules/integrations/services/integrations.service';

export interface N8nWorkflowDescriptor {
  workflow: string;
  requiredIntegration?: string;
}

@Injectable()
export class N8nIntegrationRegistryService {
  private readonly workflows: Record<string, N8nWorkflowDescriptor>;

  constructor(
    private readonly integrations: IntegrationsService,
    config: ConfigService,
  ) {
    this.workflows = this.readWorkflowMap(config.get<string>('N8N_WORKFLOW_MAP'));
  }

  resolve(toolSlug: string): N8nWorkflowDescriptor {
    return this.workflows[toolSlug] ?? { workflow: toolSlug };
  }

  async isAvailable(
    organizationId: string | undefined,
    integration: string | undefined,
  ): Promise<boolean> {
    if (!integration) return true;
    if (!organizationId) return false;
    return this.integrations.isConnected(organizationId, integration);
  }

  async assertAvailable(
    organizationId: string | undefined,
    integration: string | undefined,
  ): Promise<void> {
    if (!(await this.isAvailable(organizationId, integration))) {
      throw new Error(`Required integration "${integration}" is not ready`);
    }
  }

  private readWorkflowMap(value: string | undefined): Record<string, N8nWorkflowDescriptor> {
    if (!value) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([tool, descriptor]) => {
          if (typeof descriptor === 'string') return [[tool, { workflow: descriptor }]];
          if (!descriptor || typeof descriptor !== 'object') return [];
          const workflow = (descriptor as { workflow?: unknown }).workflow;
          const requiredIntegration = (descriptor as { requiredIntegration?: unknown })
            .requiredIntegration;
          return typeof workflow === 'string'
            ? [
                [
                  tool,
                  {
                    workflow,
                    ...(typeof requiredIntegration === 'string' ? { requiredIntegration } : {}),
                  },
                ],
              ]
            : [];
        }),
      );
    } catch {
      return {};
    }
  }
}
