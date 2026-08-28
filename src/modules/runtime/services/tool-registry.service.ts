import { Injectable, Optional } from '@nestjs/common';
import { N8nIntegrationRegistryService } from '../../../infrastructure/n8n/n8n-integration-registry.service';
import { ToolManifestService } from '../../../infrastructure/tools/tool-manifest.service';
import type { ToolManifest, ToolMode } from '../../../infrastructure/tools/tool-manifest.types';
import type { JsonValue, ToolDefinition, ToolExecutionMode } from '../interfaces/tool.interface';

export interface ToolRegistryOptions {
  mode?: ToolMode;
  includeUnimplemented?: boolean;
}

/**
 * Tool registry. Static manifest tools are the primary source; automation
 * tool resolution (from the client's provisioned n8n workflows) lands with
 * PLAN Step 10 behind the runtime cutover.
 */
@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly manifests: ToolManifestService,
    @Optional() private readonly n8nRegistry?: N8nIntegrationRegistryService,
  ) {}

  list(options?: ToolRegistryOptions): ToolDefinition[] {
    return this.manifests.list(options).map((manifest) => this.toDefinition(manifest));
  }

  find(name: string, options?: ToolRegistryOptions): ToolDefinition | undefined {
    return this.list(options).find((tool) => tool.name === name || tool.slug === name);
  }

  require(name: string, options?: ToolRegistryOptions): ToolDefinition {
    const tool = this.find(name, options);
    if (!tool) throw new Error(`Tool "${name}" is not available in the current runtime scope`);
    return tool;
  }

  async listForAgent(
    _agentId: string,
    options?: ToolRegistryOptions & { userId?: string; organizationId?: string },
  ): Promise<ToolDefinition[]> {
    const tools = this.list({
      mode: options?.mode,
      includeUnimplemented: options?.includeUnimplemented,
    });
    if (!this.n8nRegistry) return tools;
    const available = await Promise.all(
      tools.map(async (tool) => {
        if (tool.executionMode !== 'n8n') return true;
        return (
          await Promise.all(
            tool.requiredIntegrations.map((integration) =>
              this.n8nRegistry?.isAvailable(options?.organizationId, integration),
            ),
          )
        ).every(Boolean);
      }),
    );
    return tools.filter((_, index) => available[index]);
  }

  private toDefinition(manifest: ToolManifest): ToolDefinition {
    const { function: functionDefinition, woops } = manifest;
    const executionMode = this.executionMode(functionDefinition.name, woops.sideEffect);
    const sideEffect = woops.sideEffect !== 'none';
    return {
      id: functionDefinition.name,
      name: functionDefinition.name,
      slug: functionDefinition.name,
      description: functionDefinition.description,
      executionMode,
      inputSchema: functionDefinition.parameters as unknown as JsonValue,
      outputSchema: { type: 'object' },
      requiredPermissions: [`scope:${woops.scope}`],
      requiredIntegrations: [],
      requiresApproval: woops.approval === 'required',
      sideEffect,
      timeoutMs: 30_000,
      maxRetries: 0,
      retryPolicy: { maxAttempts: 1, retryableCodes: [] },
      idempotent: Boolean(woops.idempotencyKey),
      successCriteria: [],
      permissionScope: woops.scope,
    };
  }

  private executionMode(
    name: string,
    sideEffect: ToolManifest['woops']['sideEffect'],
  ): ToolExecutionMode {
    if (name === 'knowledge_search') return 'knowledge';
    if (name === 'memory_search') return 'memory';
    if (name === 'employee_get' || name === 'employee_skills_list') return 'domain';
    if (name === 'integration_status') return 'domain';
    if (name === 'human_approval') return 'approval';
    if (sideEffect === 'external_communication') return 'n8n';
    return 'ai';
  }
}
