import { Injectable, Logger } from '@nestjs/common';
import { AutomationsService } from '../../automations/services/automations.service';
import type { ToolDefinition } from '../interfaces/tool.interface';

export interface AutomationToolScope {
  userId?: string;
  organizationId?: string;
}

interface CacheEntry {
  expiresAt: number;
  tools: ToolDefinition[];
}

const CACHE_TTL_MS = 30_000;

/**
 * Enumerates ACTIVE automations (joined to their n8n connection) as runtime
 * tools, with a short-TTL cache. Automations whose connection is missing or
 * not ACTIVE are still listed — flagged INTEGRATION_UNAVAILABLE — so the
 * planner reacts instead of silently losing the capability (PLAN Step 10).
 */
@Injectable()
export class AutomationToolResolverService {
  private readonly logger = new Logger(AutomationToolResolverService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly automations: AutomationsService) {}

  async listTools(scope: AutomationToolScope): Promise<ToolDefinition[]> {
    const key = `${scope.userId ?? ''}:${scope.organizationId ?? ''}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.tools;

    let tools: ToolDefinition[];
    try {
      const rows = await this.automations.listForToolResolution(scope);
      tools = rows.map((row) => this.toToolDefinition(row));
    } catch (error) {
      this.logger.warn({
        event: 'automations.tool_resolution_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      tools = [];
    }

    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, tools });
    return tools;
  }

  invalidate(scope?: AutomationToolScope): void {
    if (!scope) {
      this.cache.clear();
      return;
    }
    this.cache.delete(`${scope.userId ?? ''}:${scope.organizationId ?? ''}`);
  }

  private toToolDefinition(row: {
    id: string;
    name: string;
    description: string | null;
    blueprint: unknown;
    webhookPath: string | null;
    connection: { id: string; baseUrl: string; status: string; deletedAt: Date | null } | null;
  }): ToolDefinition {
    const connectionUsable =
      row.connection && !row.connection.deletedAt && row.connection.status === 'ACTIVE';
    const blueprint = (row.blueprint ?? {}) as {
      goal?: string;
      summary?: string;
      inputContract?: unknown;
      outputContract?: unknown;
    };

    return {
      id: row.webhookPath ?? row.id,
      name: row.name,
      slug: row.webhookPath ?? row.id,
      description: row.description || blueprint.goal || `Provisioned automation: ${row.name}`,
      executionMode: 'n8n',
      inputSchema: this.asSchema(blueprint.inputContract),
      outputSchema: this.asSchema(blueprint.outputContract),
      requiredPermissions: ['scope:automation'],
      requiredIntegrations: [],
      requiresApproval: false, // blueprint approval already granted at design time
      sideEffect: true,
      timeoutMs: 30_000,
      maxRetries: 0,
      retryPolicy: { maxAttempts: 1, retryableCodes: [] },
      idempotent: true,
      successCriteria: [],
      permissionScope: 'automation',
      binding: connectionUsable
        ? { baseUrl: row.connection!.baseUrl, webhookPath: row.webhookPath ?? row.id }
        : undefined,
      unavailableReason: connectionUsable ? undefined : 'INTEGRATION_UNAVAILABLE',
    };
  }

  private asSchema(contract: unknown): ToolDefinition['inputSchema'] {
    if (contract && typeof contract === 'object' && !Array.isArray(contract)) {
      return contract as ToolDefinition['inputSchema'];
    }
    return { type: 'object' };
  }
}
