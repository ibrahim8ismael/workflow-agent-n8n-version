import { Injectable, Logger } from '@nestjs/common';
import type {
  ReadinessBlocker,
  WorkflowReadiness,
} from '../../modules/automations/constants/automation-readiness.constants';
import {
  blockedReadiness,
  CREDENTIAL_STATUS,
} from '../../modules/automations/constants/automation-readiness.constants';
import {
  type AutomationBlueprint,
  automationWebhookSlug,
} from '../../modules/automations/schemas/automation-blueprint.schema';
import {
  N8nClientApiError,
  N8nClientApiService,
  type N8nClientConnection,
} from './n8n-client-api.service';
import type { N8nInstanceInventory } from './n8n-node-inventory.service';

export interface ProvisionResult extends WorkflowReadiness {
  externalWorkflowId: string;
  webhookPath: string;
  /** Data tables created (or reused) during provisioning, by name. */
  dataTableIds: Record<string, string>;
  /** True when the workflow was activated in n8n (only when readyToRun). */
  activated: boolean;
}

interface ProvisionRequest {
  automationId: string;
  blueprint: AutomationBlueprint;
  connection: N8nClientConnection;
  /**
   * Harvested instance view — enables credential auto-reuse and table-id
   * mapping. Provisioning still works without it (credentials empty,
   * tables matched by name only when the instance reports them).
   */
  instance?: N8nInstanceInventory;
}

interface BuiltNode {
  parameters: Record<string, unknown>;
  type: string;
  typeVersion: number;
  position: [number, number];
  id: string;
  name: string;
  credentials?: Record<string, { id: string; name: string }>;
}

const NODE_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-zA-Z0-9.@_-]+$/;

/** Credential identity for first-use fallback (no secrets — id/name/type only). */
export interface CredentialFallbackEntry {
  id: string;
  name: string;
  type: string;
}

/** Nodes that never take fallback credentials (plumbing, no provider auth). */
const NO_CREDENTIAL_FALLBACK_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.code',
  'n8n-nodes-base.set',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.if',
  'n8n-nodes-base.dataTable',
]);

/**
 * Provisions Jaafar-designed automations into a CLIENT's n8n instance.
 * Steps carrying a `nodeHint` become the real n8n nodes Jaafar chose from
 * the instance inventory (WhatsApp, Gmail, data tables, anything installed);
 * unmapped steps fall back to a generic HTTP node or a Code skeleton.
 * Dual trigger: scheduled automations get a Schedule Trigger AND a webhook
 * so the agent can still invoke them on demand (ADR-011 runtime contract).
 */
@Injectable()
export class N8nProvisionerService {
  private readonly logger = new Logger(N8nProvisionerService.name);

  constructor(private readonly clientApi: N8nClientApiService) {}

  /**
   * Creates the workflow in n8n, then activates it ONLY when credential
   * readiness allows (`readyToRun`). Missing provider credentials produce a
   * successful build with `readyToRun=false` — never a provisioning failure.
   */
  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    const { automationId, blueprint, connection, instance } = request;
    const webhookPath = automationWebhookSlug(automationId, blueprint.name);

    const dataTableIds = await this.ensureDataTables(blueprint, instance, connection);
    const credentialFallback = await this.loadCredentialFallback(connection);

    const { payload: workflow, readinessBlockers } = this.buildWorkflow({
      automationId,
      blueprint,
      webhookPath,
      dataTableIds,
      instance,
      credentialFallback,
    });
    const readiness = blockedReadiness(readinessBlockers);

    const created = await this.createWorkflow(connection, workflow);

    // Read back to capture the effective webhook path (drift/collision safety).
    const detail = await this.getWorkflow(connection, created.id);
    const hooks = N8nClientApiService.extractWebhookPaths(detail);
    const effectivePath = hooks[0]?.path ?? webhookPath;

    let activated = false;
    if (readiness.readyToRun) {
      await this.activateWorkflow(connection, created.id);
      activated = true;
    }

    this.logger.log({
      event: 'n8n.automation_provisioned',
      automationId,
      workflowId: created.id,
      webhookPath: effectivePath,
      dataTables: Object.keys(dataTableIds),
      activated,
      readinessBlockers: readiness.readinessBlockers.length,
    });
    return {
      externalWorkflowId: created.id,
      webhookPath: effectivePath,
      dataTableIds,
      activated,
      ...readiness,
    };
  }

  /** Creation and activation are separate operations (create ≠ activate). */
  async createWorkflow(
    connection: N8nClientConnection,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    return this.clientApi.createWorkflow(connection, payload);
  }

  async activateWorkflow(connection: N8nClientConnection, id: string): Promise<void> {
    await this.clientApi.activateWorkflow(connection, id);
  }

  async getWorkflow(connection: N8nClientConnection, id: string) {
    return this.clientApi.getWorkflow(connection, id);
  }

  /**
   * Re-evaluates credential readiness for an existing blueprint without
   * recreating the workflow (used by readiness refresh after the user
   * connects credentials).
   */
  async inspectReadiness(input: {
    blueprint: AutomationBlueprint;
    instance?: N8nInstanceInventory;
    credentialFallback?: CredentialFallbackEntry[];
    connection?: N8nClientConnection;
  }): Promise<WorkflowReadiness> {
    let fallback = input.credentialFallback;
    if (!fallback && input.connection) {
      fallback = await this.loadCredentialFallback(input.connection);
    }
    const blockers = this.computeReadinessBlockers(input.blueprint, input.instance, fallback ?? []);
    return blockedReadiness(blockers);
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * All data tables the workflow references: declared in
   * `blueprint.dataTables` PLUS tables inferred from dataTable node hints
   * (Jaafar sometimes references `parameters.tableName` without declaring
   * the table — self-heal by deriving columns from the hint's column map).
   */
  private referencedTables(
    blueprint: AutomationBlueprint,
  ): Map<string, Array<{ name: string; type: string }>> {
    const map = new Map<string, Array<{ name: string; type: string }>>();
    for (const table of blueprint.dataTables ?? []) {
      map.set(
        table.name,
        table.columns.map((column) => ({ name: column.name, type: column.type })),
      );
    }
    for (const step of blueprint.steps) {
      if (step.nodeHint?.type !== 'n8n-nodes-base.dataTable') continue;
      const tableName = step.nodeHint.parameters.tableName;
      if (typeof tableName !== 'string' || tableName.length === 0 || map.has(tableName)) continue;
      const raw = step.nodeHint.parameters.columns;
      const columns =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({
              name,
              type:
                typeof value === 'number'
                  ? 'number'
                  : typeof value === 'boolean'
                    ? 'boolean'
                    : 'string',
            }))
          : [{ name: 'value', type: 'string' }];
      map.set(tableName, columns);
    }
    return map;
  }

  /**
   * Creates any referenced data tables that do not exist yet and resolves
   * ids for all of them (existing ones come from the instance inventory).
   * Best-effort per table: a single failure must not block the whole
   * provisioning — n8n surfaces the missing table at execution.
   */
  private async ensureDataTables(
    blueprint: AutomationBlueprint,
    instance: N8nInstanceInventory | undefined,
    connection: N8nClientConnection,
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    const existing = new Map<string, string>();
    for (const table of instance?.dataTables ?? []) {
      existing.set(table.name, table.id);
    }
    for (const [name, columns] of this.referencedTables(blueprint)) {
      const known = existing.get(name);
      if (known) {
        ids[name] = known;
        continue;
      }
      try {
        const created = await this.clientApi.createDataTable(connection, {
          name,
          columns,
        });
        ids[name] = created.id;
        existing.set(name, created.id);
      } catch (error) {
        this.logger.warn({
          event: 'n8n.datatable_create_failed',
          table: name,
          message: error instanceof N8nClientApiError ? error.message : String(error),
        });
      }
    }
    return ids;
  }

  private buildWorkflow(input: {
    automationId: string;
    blueprint: AutomationBlueprint;
    webhookPath: string;
    dataTableIds: Record<string, string>;
    instance?: N8nInstanceInventory;
    credentialFallback?: CredentialFallbackEntry[];
  }): { payload: Record<string, unknown>; readinessBlockers: ReadinessBlocker[] } {
    const { automationId, blueprint, webhookPath, dataTableIds, instance, credentialFallback } =
      input;
    const isSchedule = blueprint.trigger.type === 'schedule';
    const isManual = blueprint.trigger.type === 'manual';

    // Trigger nodes cannot sit mid-chain: any step hinted as a trigger is
    // hoisted to entry position and replaces the generated equivalent.
    const TRIGGER_TYPES = new Set([
      'n8n-nodes-base.scheduleTrigger',
      'n8n-nodes-base.manualTrigger',
      'n8n-nodes-base.webhook',
    ]);
    const hintedTriggerSteps = blueprint.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.nodeHint && TRIGGER_TYPES.has(step.nodeHint.type));
    const actionSteps = blueprint.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => !(step.nodeHint && TRIGGER_TYPES.has(step.nodeHint.type)));

    const triggerNodes: BuiltNode[] = [];
    const hasHintedSchedule = hintedTriggerSteps.some(
      ({ step }) => step.nodeHint?.type === 'n8n-nodes-base.scheduleTrigger',
    );
    if (isSchedule && !hasHintedSchedule) {
      triggerNodes.push(this.scheduleTriggerNode(automationId, blueprint.trigger.config, isManual));
    }
    if (isManual) {
      triggerNodes.push(this.manualTriggerNode(automationId));
    }
    const webhookNode = this.webhookNode(automationId, webhookPath);

    const entryNodes: BuiltNode[] = [
      ...triggerNodes,
      ...hintedTriggerSteps.map(({ step, index }) =>
        this.stepNode(step, index, automationId, dataTableIds, instance, credentialFallback),
      ),
      webhookNode,
    ];

    const stepNodes = actionSteps.map(({ step, index }) =>
      this.stepNode(step, index, automationId, dataTableIds, instance, credentialFallback),
    );

    const respondNode = this.respondNode(automationId, stepNodes.length);

    const nodes = [...entryNodes, ...stepNodes, respondNode];

    const firstEntry = stepNodes[0] ?? respondNode;
    const connections: Record<string, unknown> = {};
    for (const entry of entryNodes) {
      connections[entry.name] = { main: [[{ node: firstEntry.name, type: 'main', index: 0 }]] };
    }
    const chain = [...stepNodes, respondNode];
    for (let i = 0; i < chain.length - 1; i++) {
      connections[chain[i]!.name] = {
        main: [[{ node: chain[i + 1]!.name, type: 'main', index: 0 }]],
      };
    }

    const readinessBlockers = this.computeReadinessBlockers(
      blueprint,
      instance,
      credentialFallback ?? [],
    );

    return {
      payload: {
        name: `Woops - ${blueprint.name} (${automationId.slice(0, 8)})`,
        nodes,
        connections,
        settings: { executionOrder: 'v1' },
      },
      readinessBlockers,
    };
  }

  /**
   * Credential readiness for every generated integration node.
   *
   * - Plumbing nodes (webhook/code/http/…) never require provider credentials.
   * - Native integration nodes without an attached credential become
   *   NEEDS_CREDENTIAL blockers — the workflow is still created.
   * - Ambiguous fallback matches become blockers (with detail), not build
   *   failures: the workflow can be created, the user resolves credentials.
   */
  private computeReadinessBlockers(
    blueprint: AutomationBlueprint,
    instance: N8nInstanceInventory | undefined,
    credentialFallback: CredentialFallbackEntry[],
  ): ReadinessBlocker[] {
    const blockers: ReadinessBlocker[] = [];
    blueprint.steps.forEach((step, index) => {
      const hint = step.nodeHint;
      if (!hint || !NODE_TYPE_PATTERN.test(hint.type)) return;
      if (NO_CREDENTIAL_FALLBACK_TYPES.has(hint.type)) return;
      const nodeId = step.id ?? `step-${index + 1}`;
      const integration = (step.integration ?? '').trim() || hint.type.split('.').pop()!;
      let attached: Record<string, { id: string; name: string }> | undefined;
      let ambiguousDetail: string | undefined;
      try {
        attached = this.reuseCredentials(hint.type, instance, credentialFallback);
      } catch (error) {
        ambiguousDetail = error instanceof Error ? error.message : String(error);
        attached = undefined;
      }
      if (attached && Object.keys(attached).length > 0) return;
      const observed = instance?.nodeTypes.find((n) => n.type === hint.type);
      const observedType = observed?.credentials ? Object.keys(observed.credentials)[0] : undefined;
      const credentialType =
        hint.credentialType ??
        observedType ??
        this.inferCredentialType(hint.type, fallbackTypes(credentialFallback));
      blockers.push({
        nodeId,
        integration:
          integration
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || integration,
        credentialStatus: CREDENTIAL_STATUS.NEEDS_CREDENTIAL,
        ...(credentialType ? { credentialType } : {}),
        ...(ambiguousDetail ? { detail: ambiguousDetail } : {}),
      });
    });
    return blockers;
  }

  private inferCredentialType(nodeType: string, fallbackTypes: string[]): string | undefined {
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dot = nodeType.lastIndexOf('.');
    const suffix = normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
    if (!suffix) return undefined;
    const match = fallbackTypes.find((type) => {
      const credNorm = normalize(type);
      return credNorm === suffix || credNorm.startsWith(suffix) || suffix.startsWith(credNorm);
    });
    return match;
  }

  private webhookNode(automationId: string, webhookPath: string): BuiltNode {
    return {
      parameters: {
        httpMethod: 'POST',
        path: webhookPath,
        responseMode: 'lastNode',
        options: {},
      },
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      id: `webhook-${automationId.slice(0, 8)}`,
      name: `Webhook: ${webhookPath}`,
    };
  }

  private scheduleTriggerNode(
    automationId: string,
    config: Record<string, unknown>,
    offsetManual: boolean,
  ): BuiltNode {
    return {
      parameters: { rule: { interval: this.scheduleInterval(config) } },
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [offsetManual ? -400 : -200, 0],
      id: `schedule-${automationId.slice(0, 8)}`,
      name: 'Schedule Trigger',
    };
  }

  private manualTriggerNode(automationId: string): BuiltNode {
    return {
      parameters: {},
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [-200, 0],
      id: `manual-${automationId.slice(0, 8)}`,
      name: 'Manual Trigger',
    };
  }

  /** Maps blueprint trigger config onto a scheduleTrigger interval rule. */
  private scheduleInterval(config: Record<string, unknown>): Array<Record<string, unknown>> {
    const cron = typeof config.cron === 'string' ? config.cron : undefined;
    if (cron) return [{ field: 'cronExpression', expression: cron }];
    const every = typeof config.every === 'number' && config.every > 0 ? config.every : 15;
    const unit = typeof config.unit === 'string' ? config.unit : 'minutes';
    if (unit === 'hours') return [{ field: 'hours', hoursInterval: every }];
    if (unit === 'days') return [{ field: 'days', daysInterval: every }];
    return [{ field: 'minutes', minutesInterval: every }];
  }

  private respondNode(automationId: string, stepCount: number): BuiltNode {
    return {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify($json) }}',
      },
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [250 + stepCount * 250, 0],
      id: `respond-${automationId.slice(0, 8)}`,
      name: 'Respond to Agent Engine',
    };
  }

  private stepNode(
    step: AutomationBlueprint['steps'][number],
    index: number,
    automationId: string,
    dataTableIds: Record<string, string>,
    instance?: N8nInstanceInventory,
    credentialFallback?: CredentialFallbackEntry[],
  ): BuiltNode {
    const id = `step-${index + 1}-${automationId.slice(0, 8)}`;
    const name = `Step ${index + 1}: ${step.name}`;
    const base: BuiltNode = {
      parameters: {},
      type: '',
      typeVersion: 1,
      position: [250 + index * 250, 0],
      id,
      name,
    };

    // 1) Jaafar's node choice from the instance inventory.
    const hint = step.nodeHint;
    if (hint && NODE_TYPE_PATTERN.test(hint.type)) {
      const parameters: Record<string, unknown> = { ...hint.parameters };
      // Resolve data-table references to real table ids. The dataTable node
      // expects `dataTableId` as a resource-locator object.
      if (
        hint.type === 'n8n-nodes-base.dataTable' &&
        typeof parameters.tableName === 'string' &&
        dataTableIds[parameters.tableName]
      ) {
        parameters.dataTableId = {
          __rl: true,
          mode: 'id',
          value: dataTableIds[parameters.tableName],
        };
        delete parameters.tableName;
      }
      // Ambiguous fallback matches become unconfigured nodes + readiness
      // blockers (handled in computeReadinessBlockers), not build failures.
      let credentials: BuiltNode['credentials'];
      try {
        credentials = this.reuseCredentials(hint.type, instance, credentialFallback);
      } catch {
        credentials = undefined;
      }
      const node: BuiltNode = {
        ...base,
        type: hint.type,
        typeVersion: hint.typeVersion ?? 1,
        parameters,
        ...(credentials ? { credentials } : {}),
      };
      return node;
    }

    // 2) Generic HTTP adapter for API-shaped steps with a url.
    const url = typeof step.config.url === 'string' ? step.config.url : undefined;
    if (url) {
      return {
        ...base,
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        parameters: {
          method: typeof step.config.method === 'string' ? step.config.method : 'POST',
          url,
          ...(step.config.headers && typeof step.config.headers === 'object'
            ? { sendHeaders: true, headerParameters: { parameters: step.config.headers } }
            : {}),
          ...(step.config.body !== undefined
            ? { sendBody: true, jsonBody: `={{ ${JSON.stringify(step.config.body)} }}` }
            : {}),
          options: {},
        },
      };
    }

    // 3) Conservative Code skeleton (existing behavior).
    const todo = [
      `// Automation: ${step.name} (${automationId})`,
      `// Step ${index + 1}: ${step.action}`,
      ...(step.integration ? [`// Integration: ${step.integration}`] : []),
      `// TODO: replace this skeleton with real integration logic`,
      `// Blueprint config: ${JSON.stringify(step.config ?? {})}`,
    ].join('\n');
    return {
      ...base,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: {
        jsCode: `${todo}\nconst payload = $json.body || $json;\nconst input = payload.input || {};\n\nreturn {\n  json: {\n    success: true,\n    step: ${JSON.stringify(step.name)},\n    data: { inputReceived: input },\n    timestamp: new Date().toISOString(),\n  },\n};`,
      },
    };
  }

  /**
   * Available credential identities for first-use fallback (id/name/type
   * only — the public API never returns secrets). Loaded best-effort once
   * per provisioning.
   */
  private async loadCredentialFallback(
    connection: N8nClientConnection,
  ): Promise<CredentialFallbackEntry[]> {
    try {
      return await this.clientApi.listCredentials(connection);
    } catch {
      return [];
    }
  }

  /**
   * When the client's instance already uses this node type with credentials,
   * attach the first observed credential reference so the provisioned node
   * works without manual wiring. First-use fallback: when the node type was
   * never used but the instance holds a uniquely matching credential (by
   * normalized credential-type ↔ node-suffix similarity), attach it.
   * Structural/plumbing nodes never take fallback credentials. Ambiguous
   * matches throw so readiness inspection can record a NEEDS_CREDENTIAL
   * blocker with detail; `stepNode()` catches this and still creates the
   * node unconfigured. Users can swap credentials in the n8n editor.
   */
  private reuseCredentials(
    nodeType: string,
    instance?: N8nInstanceInventory,
    credentialFallback?: CredentialFallbackEntry[],
  ): Record<string, { id: string; name: string }> | undefined {
    const observed = instance?.nodeTypes.find((n) => n.type === nodeType);
    if (observed?.credentials && Object.keys(observed.credentials).length > 0) {
      return observed.credentials;
    }
    if (!credentialFallback || credentialFallback.length === 0) return undefined;
    if (NO_CREDENTIAL_FALLBACK_TYPES.has(nodeType)) return undefined;
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dot = nodeType.lastIndexOf('.');
    const suffix = normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
    if (!suffix) return undefined;
    const matches = credentialFallback.filter((credential) => {
      const credNorm = normalize(credential.type);
      return credNorm === suffix || credNorm.startsWith(suffix) || suffix.startsWith(credNorm);
    });
    if (matches.length === 1) {
      const match = matches[0] as CredentialFallbackEntry;
      return { [match.type]: { id: match.id, name: match.name } };
    }
    if (matches.length > 1) {
      throw new Error(
        `Cannot uniquely resolve a credential for node "${nodeType}": found ${matches.map((m) => `"${m.name}" (${m.type})`).join(', ')}. Keep a single matching credential or wire it explicitly in n8n.`,
      );
    }
    return undefined;
  }
}

function fallbackTypes(fallback: CredentialFallbackEntry[]): string[] {
  return (fallback ?? []).map((entry) => entry.type).filter((type) => typeof type === 'string');
}
