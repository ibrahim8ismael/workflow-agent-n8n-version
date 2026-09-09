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

export type N8nNodeSchemaErrorCode = 'NODE_NOT_FOUND' | 'OPERATION_NOT_SUPPORTED';

/** Structured rejection for hallucinated node types / operations. */
export class N8nNodeSchemaError extends Error {
  constructor(
    message: string,
    readonly code: N8nNodeSchemaErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = N8nNodeSchemaError.name;
  }
}

/**
 * LLM-safe description of one node type. Credential TYPE names only —
 * never credential ids or secrets. `source` tells the caller how much
 * to trust the required/optional lists.
 */
export interface N8nNodeSchema {
  nodeType: string;
  typeVersion?: number;
  operation?: string;
  required: string[];
  optional: string[];
  /** Credential TYPE names (e.g. `slackOAuth2Api`) — never ids or secrets. */
  credentials: string[];
  /** Known operations for this node, when the catalog documents them. */
  operations?: string[];
  /** True when the requested operation is in the known list. */
  operationVerified: boolean;
  /**
   * One real parameter sample harvested from the owner's own instance, when
   * available. Values included — same trust boundary as the workflow
   * definitions the design context already carries.
   */
  parametersObserved?: Record<string, unknown>;
  source: 'curated' | 'harvested' | 'seed';
  /** False for structural entries not yet present in the instance. */
  inUse: boolean;
}

interface CuratedNodeSchema {
  required: string[];
  optional: string[];
  /** Documented operations. Empty + exhaustive = node takes no operation. */
  operations: string[];
  /** True only when the operation list is complete (trigger/plumbing nodes). */
  operationsExhaustive: boolean;
}

/**
 * Hand-verified schemas for structural nodes. Integration nodes resolve
 * from the instance harvest (real versions, samples, credential types);
 * a small operation catalog below documents the most common ones.
 */
const CURATED_SCHEMAS: Record<string, CuratedNodeSchema> = {
  'n8n-nodes-base.webhook': {
    required: [],
    optional: ['httpMethod', 'path', 'responseMode', 'responseCode', 'options'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.scheduleTrigger': {
    required: [],
    optional: ['rule'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.manualTrigger': {
    required: [],
    optional: [],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.respondToWebhook': {
    required: [],
    optional: ['respondWith', 'responseBody', 'responseCode', 'responseHeaders', 'options'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.code': {
    required: ['jsCode'],
    optional: ['mode'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.set': {
    required: ['assignments'],
    optional: ['options', 'include'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.httpRequest': {
    required: ['method', 'url'],
    optional: [
      'authentication',
      'sendHeaders',
      'headerParameters',
      'sendBody',
      'contentType',
      'body',
      'options',
    ],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.if': {
    required: ['conditions'],
    optional: ['options', 'looseTypeValidation'],
    operations: [],
    operationsExhaustive: true,
  },
  'n8n-nodes-base.slack': {
    required: [],
    optional: ['channel', 'text', 'resource', 'operation'],
    operations: [
      'send',
      'update',
      'delete',
      'getPermalink',
      'create',
      'archive',
      'invite',
      'kick',
      'get',
      'getAll',
    ],
    operationsExhaustive: false,
  },
  'n8n-nodes-base.gmail': {
    required: [],
    optional: ['resource', 'operation', 'subject', 'emailType', 'message'],
    operations: ['send', 'reply', 'get', 'getAll', 'delete', 'create', 'markAsRead'],
    operationsExhaustive: false,
  },
  'n8n-nodes-base.googleSheets': {
    required: [],
    optional: ['resource', 'operation', 'documentId', 'sheetName', 'columns'],
    operations: ['append', 'appendOrUpdate', 'clear', 'create', 'delete', 'read', 'update'],
    operationsExhaustive: false,
  },
  'n8n-nodes-base.telegram': {
    required: [],
    optional: ['resource', 'operation', 'chatId', 'text', 'additionalFields'],
    operations: ['sendMessage', 'sendPhoto', 'sendDocument', 'editMessageText', 'deleteMessage'],
    operationsExhaustive: false,
  },
};

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

  /**
   * `get_node_schema(nodeType, operation)` — resolves one node type against
   * the instance inventory and returns its LLM-safe schema. Unknown node
   * types are rejected with NODE_NOT_FOUND (plus the available types);
   * operations on nodes with an exhaustive operation list are rejected with
   * OPERATION_NOT_SUPPORTED. Integration nodes carry a non-exhaustive
   * catalog, so undocumented operations resolve with
   * `operationVerified: false` instead of failing the build.
   */
  async describeNodeType(
    connection: N8nClientConnection,
    nodeType: string,
    operation?: string,
  ): Promise<N8nNodeSchema> {
    const inventory = await this.inventory(connection);
    const observation = this.resolveNodeType(inventory.nodeTypes, nodeType);
    if (!observation) {
      const available = inventory.nodeTypes
        .map((node) => node.type)
        .sort()
        .slice(0, 50);
      throw new N8nNodeSchemaError(
        `Unknown n8n node type "${nodeType}". Use one of the available types.`,
        'NODE_NOT_FOUND',
        { requested: nodeType, available },
      );
    }

    const curated = CURATED_SCHEMAS[observation.type];
    const credentials = Object.keys(observation.credentials ?? {});
    const parametersObserved = this.summarizeParameters(observation.sampleParameters);

    if (operation !== undefined && curated?.operationsExhaustive) {
      throw new N8nNodeSchemaError(
        `Node "${observation.type}" takes no operation — "${operation}" cannot be applied.`,
        'OPERATION_NOT_SUPPORTED',
        { nodeType: observation.type, requested: operation },
      );
    }

    const knownOperations = curated?.operations.length ? curated.operations : undefined;
    return {
      nodeType: observation.type,
      ...(observation.typeVersion !== undefined ? { typeVersion: observation.typeVersion } : {}),
      ...(operation !== undefined ? { operation } : {}),
      required: curated?.required ?? [],
      optional: curated?.optional ?? Object.keys(parametersObserved ?? {}),
      credentials,
      ...(knownOperations ? { operations: knownOperations } : {}),
      operationVerified:
        operation === undefined ? true : (knownOperations?.includes(operation) ?? false),
      ...(parametersObserved ? { parametersObserved } : {}),
      source: curated ? 'curated' : observation.inUse ? 'harvested' : 'seed',
      inUse: observation.inUse,
    };
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

  /**
   * Resolves a node type reference: exact match first, then a short-name
   * suffix match (`slack` → `n8n-nodes-base.slack`). Ambiguous short names
   * resolve to nothing so the caller gets the explicit candidate list.
   */
  private resolveNodeType(
    nodeTypes: N8nNodeTypeObservation[],
    reference: string,
  ): N8nNodeTypeObservation | undefined {
    const exact = nodeTypes.find((node) => node.type === reference);
    if (exact) return exact;
    const short = reference.toLowerCase();
    if (!short || short.includes('.')) return undefined;
    const matches = nodeTypes.filter((node) => node.type.toLowerCase().endsWith(`.${short}`));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Top-level parameter keys of a harvested sample (capped, names only). */
  private summarizeParameters(
    sample: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!sample || typeof sample !== 'object') return undefined;
    const keys = Object.keys(sample).slice(0, 30);
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = sample[key];
    return out;
  }
}
