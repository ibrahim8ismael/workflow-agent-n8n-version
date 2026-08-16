import { Injectable, Optional } from '@nestjs/common';
import { N8nIntegrationRegistryService } from '../../../infrastructure/n8n/n8n-integration-registry.service';
import { ToolManifestService } from '../../../infrastructure/tools/tool-manifest.service';
import type { ToolManifest, ToolMode } from '../../../infrastructure/tools/tool-manifest.types';
import type { AssignedAgentSkill } from '../../agents/interfaces/agent.interface';
import { AgentsService } from '../../agents/services/agents.service';
import type { JsonValue, ToolDefinition, ToolExecutionMode } from '../interfaces/tool.interface';

export interface ToolRegistryOptions {
  mode?: ToolMode;
  includeUnimplemented?: boolean;
}

@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly manifests: ToolManifestService,
    private readonly agentsService: AgentsService,
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
    agentId: string,
    options?: ToolRegistryOptions & { userId?: string; organizationId?: string },
  ): Promise<ToolDefinition[]> {
    const staticTools = this.list({
      mode: options?.mode,
      includeUnimplemented: options?.includeUnimplemented,
    });
    const assignedSkills = await this.agentsService.getAssignedSkills(agentId, {
      userId: options?.userId,
      organizationId: options?.organizationId,
    });
    const assignedTools = assignedSkills
      .filter((assignment) => this.availableInMode(assignment, options?.mode))
      .map((assignment) => this.toSkillDefinition(assignment));
    const tools = this.mergeStableTools(staticTools, assignedTools);
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

  private toSkillDefinition(assignment: AssignedAgentSkill): ToolDefinition {
    const skill = assignment.skill;
    const retryPolicy = skill.retryPolicy ?? {};
    const maxAttempts = this.toPositiveNumber(retryPolicy.maxAttempts, 1);
    const metadata = skill.metadata ?? {};
    const requiredIntegrations = Array.isArray(metadata.requiredIntegrations)
      ? metadata.requiredIntegrations.filter((value): value is string => typeof value === 'string')
      : [];
    const idempotencyKey =
      typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : undefined;

    return {
      id: skill.slug,
      name: skill.slug,
      slug: skill.slug,
      description: skill.description ?? skill.name,
      instructions: skill.instructions,
      executionMode: this.skillExecutionMode(skill.executionMode),
      inputSchema: (skill.inputSchema ?? { type: 'object' }) as unknown as JsonValue,
      outputSchema: (skill.outputSchema ?? {}) as unknown as JsonValue,
      requiredPermissions: [`scope:${this.permissionScope(skill)}`],
      requiredIntegrations,
      requiresApproval: this.requiresApproval(skill, metadata),
      sideEffect: this.hasSideEffect(metadata),
      timeoutMs: this.toPositiveNumber(skill.timeout, 30_000),
      maxRetries: Math.max(0, maxAttempts - 1),
      retryPolicy: {
        maxAttempts,
        retryableCodes: this.stringList(retryPolicy.retryableCodes),
      },
      idempotent: Boolean(idempotencyKey),
      successCriteria: this.stringList(skill.successCriteria),
      permissionScope: this.permissionScope(skill),
    };
  }

  private availableInMode(assignment: AssignedAgentSkill, mode?: ToolMode): boolean {
    if (!mode) return true;
    const configuredModes = assignment.skill.metadata?.availableIn;
    return !Array.isArray(configuredModes) || configuredModes.includes(mode);
  }

  private mergeStableTools(staticTools: ToolDefinition[], assignedTools: ToolDefinition[]) {
    const tools = new Map<string, ToolDefinition>();
    for (const tool of staticTools) tools.set(tool.id, tool);
    for (const tool of assignedTools) {
      if (!tools.has(tool.id)) tools.set(tool.id, tool);
    }
    return [...tools.values()];
  }

  private skillExecutionMode(mode: string): ToolExecutionMode {
    switch (mode) {
      case 'KNOWLEDGE_RETRIEVAL':
        return 'knowledge';
      case 'MEMORY_RETRIEVAL':
        return 'memory';
      case 'N8N_WORKFLOW':
        return 'n8n';
      case 'HUMAN_APPROVAL':
        return 'approval';
      case 'HYBRID':
        return 'hybrid';
      default:
        return 'ai';
    }
  }

  private permissionScope(skill: AssignedAgentSkill['skill']): string {
    if (skill.organizationId) return 'organization';
    if (skill.userId) return 'user_or_organization';
    return 'user_or_organization';
  }

  private requiresApproval(skill: AssignedAgentSkill['skill'], metadata: Record<string, unknown>) {
    return skill.executionMode === 'HUMAN_APPROVAL' || metadata.requiresApproval !== false;
  }

  private hasSideEffect(metadata: Record<string, unknown>): boolean {
    return metadata.sideEffect !== undefined && metadata.sideEffect !== 'none';
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private toPositiveNumber(value: unknown, fallback: number): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  private executionMode(
    name: string,
    sideEffect: ToolManifest['woops']['sideEffect'],
  ): ToolExecutionMode {
    if (name === 'knowledge_search') return 'knowledge';
    if (name === 'memory_search') return 'memory';
    if (name === 'employee_get' || name === 'employee_skills_list') return 'domain';
    if (name === 'employee_create_draft' || name === 'employee_blueprint_prepare') return 'domain';
    if (name === 'integration_status') return 'domain';
    if (name === 'human_approval') return 'approval';
    if (sideEffect === 'external_communication') return 'n8n';
    return 'ai';
  }
}
