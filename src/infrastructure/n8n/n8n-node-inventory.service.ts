import { Injectable, Logger } from '@nestjs/common';
import {
  N8nClientApiError,
  N8nClientApiService,
  type N8nClientConnection,
  type N8nDataTable,
} from './n8n-client-api.service';

/** A node type observed in (or seeded for) the client's n8n instance. */
export interface N8nNodeTypeObservation {
  type: string;
  /** Highest typeVersion seen for this node type. */
  typeVersion?: number;
  /** One real parameter sample harvested from the instance. */
  sampleParameters?: Record<string, unknown>;
  /**
   * Credential references seen on nodes of this type, keyed by credential
   * type name (e.g. `whatsAppCloudApi`). Used to auto-wire credentials.
   */
  credentials?: Record<string, { id: string; name: string }>;
  /** false for structural seed entries not yet present in the instance. */
  inUse: boolean;
}

export interface N8nInstanceInventory {
  nodeTypes: N8nNodeTypeObservation[];
  dataTables: N8nDataTable[];
  /** True when the instance exposes the data-tables API (n8n 1.100+). */
  dataTablesSupported: boolean;
}

/**
 * Workflow-structural nodes every provisioned workflow may need. These are
 * plumbing only — integration node visibility comes from the client
 * instance itself (ADR: Jaafar sees the user's n8n, not a hardcoded list).
 */
const STRUCTURAL_SEED: Array<{ type: string; typeVersion: number }> = [
  { type: 'n8n-nodes-base.webhook', typeVersion: 2 },
  { type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2 },
  { type: 'n8n-nodes-base.manualTrigger', typeVersion: 1 },
  { type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1 },
  { type: 'n8n-nodes-base.code', typeVersion: 2 },
  { type: 'n8n-nodes-base.set', typeVersion: 3.4 },
  { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 },
  { type: 'n8n-nodes-base.dataTable', typeVersion: 1 },
];

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expiresAt: number;
  value: N8nInstanceInventory;
}

/**
 * Builds a per-instance view of what the client's n8n can do: node types
 * actually present in their workflows (with versions, parameter samples and
 * credential references) plus their data tables. Consumed by the Jaafar
 * design context so blueprints reference real, existing capabilities.
 */
@Injectable()
export class N8nNodeInventoryService {
  private readonly logger = new Logger(N8nNodeInventoryService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly clientApi: N8nClientApiService) {}

  async inventory(connection: N8nClientConnection): Promise<N8nInstanceInventory> {
    const key = `${connection.baseUrl}|${connection.apiKey}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.build(connection);
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  invalidate(connection: N8nClientConnection): void {
    this.cache.delete(`${connection.baseUrl}|${connection.apiKey}`);
  }

  // ── internals ──────────────────────────────────────────────

  private async build(connection: N8nClientConnection): Promise<N8nInstanceInventory> {
    const [nodeTypes, dataTables] = await Promise.all([
      this.harvestNodeTypes(connection),
      this.loadDataTables(connection),
    ]);
    return { nodeTypes, dataTables: dataTables.tables, dataTablesSupported: dataTables.supported };
  }

  private async harvestNodeTypes(
    connection: N8nClientConnection,
  ): Promise<N8nNodeTypeObservation[]> {
    const observed = new Map<string, N8nNodeTypeObservation>();
    try {
      const workflows = await this.clientApi.listWorkflowDetails(connection);
      for (const workflow of workflows) {
        for (const node of workflow.nodes ?? []) {
          if (!node.type) continue;
          const existing = observed.get(node.type);
          const version =
            typeof node.typeVersion === 'number' ? node.typeVersion : existing?.typeVersion;
          if (!existing) {
            observed.set(node.type, {
              type: node.type,
              typeVersion: version,
              sampleParameters: node.parameters ?? undefined,
              credentials: this.harvestCredentials(node),
              inUse: true,
            });
          } else {
            existing.typeVersion =
              version !== undefined &&
              (existing.typeVersion === undefined || version > existing.typeVersion)
                ? version
                : existing.typeVersion;
            existing.credentials = {
              ...(existing.credentials ?? {}),
              ...(this.harvestCredentials(node) ?? {}),
            };
          }
        }
      }
    } catch (error) {
      // Design must proceed even when the instance cannot be read.
      this.logger.warn({
        event: 'n8n.inventory_harvest_failed',
        baseUrl: connection.baseUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const merged: N8nNodeTypeObservation[] = STRUCTURAL_SEED.map((seed) => ({
      ...(observed.get(seed.type) ?? { type: seed.type, typeVersion: seed.typeVersion }),
      inUse: observed.has(seed.type),
    }));
    for (const [type, observation] of observed) {
      if (!STRUCTURAL_SEED.some((seed) => seed.type === type)) merged.push(observation);
    }
    return merged;
  }

  private harvestCredentials(node: {
    credentials?: unknown;
  }): Record<string, { id: string; name: string }> | undefined {
    if (!node.credentials || typeof node.credentials !== 'object') return undefined;
    const out: Record<string, { id: string; name: string }> = {};
    for (const [credType, ref] of Object.entries(node.credentials as Record<string, unknown>)) {
      if (
        ref &&
        typeof ref === 'object' &&
        'id' in ref &&
        typeof (ref as { id: unknown }).id === 'string'
      ) {
        const named = ref as { id: string; name?: unknown };
        out[credType] = {
          id: named.id,
          name: typeof named.name === 'string' ? named.name : '',
        };
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private async loadDataTables(
    connection: N8nClientConnection,
  ): Promise<{ tables: N8nDataTable[]; supported: boolean }> {
    try {
      return { tables: await this.clientApi.listDataTables(connection), supported: true };
    } catch (error) {
      if (
        error instanceof N8nClientApiError &&
        error.statusCode !== undefined &&
        error.statusCode === 404
      ) {
        // n8n < 1.100 — data tables simply do not exist on this instance.
        return { tables: [], supported: false };
      }
      this.logger.warn({
        event: 'n8n.inventory_datatables_failed',
        baseUrl: connection.baseUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      return { tables: [], supported: false };
    }
  }
}
