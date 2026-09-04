import { Injectable, Optional } from '@nestjs/common';
import { ToolManifestService } from '../../../infrastructure/tools/tool-manifest.service';
import type { ToolManifest, ToolMode } from '../../../infrastructure/tools/tool-manifest.types';
import type { JsonValue, ToolDefinition, ToolExecutionMode } from '../interfaces/tool.interface';
import type { AutomationToolResolverService } from './automation-tool-resolver.service';

export interface ToolRegistryOptions {
  mode?: ToolMode;
  includeUnimplemented?: boolean;
}

/**
 * Tool registry. Static manifest tools are the primary source; automation
 * tools (from the client's provisioned n8n workflows) are enumerated from
 * ACTIVE Automation rows via the resolver (PLAN Step 10).
 */
@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly manifests: ToolManifestService,
    @Optional() private readonly automationResolver?: AutomationToolResolverService,
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
    const staticTools = this.list({
      mode: options?.mode,
      includeUnimplemented: options?.includeUnimplemented,
    });
    const automationTools = this.automationResolver
      ? await this.automationResolver.listTools({
          userId: options?.userId,
          organizationId: options?.organizationId,
        })
      : [];
    const tools = this.mergeStableTools(staticTools, automationTools);
    return tools;
  }

  private mergeStableTools(primary: ToolDefinition[], secondary: ToolDefinition[]) {
    const tools = new Map<string, ToolDefinition>();
    for (const tool of primary) tools.set(tool.id, tool);
    for (const tool of secondary) {
      if (!tools.has(tool.id)) tools.set(tool.id, tool);
    }
    return [...tools.values()];
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
