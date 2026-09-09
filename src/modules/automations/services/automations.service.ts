import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { N8nClientApiError } from '../../../infrastructure/n8n/n8n-client-api.service';
import { N8nNodeInventoryService } from '../../../infrastructure/n8n/n8n-node-inventory.service';
import { N8nProvisionerService } from '../../../infrastructure/n8n/n8n-provisioner.service';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { AUTOMATION_STATUS, type AutomationStatus } from '../constants/automation-status.constants';
import type { CreateAutomationFromBlueprintDto } from '../dto/automation.dto';
import type { OwnerScope } from '../repositories/automations.repository';
import { AutomationsRepository } from '../repositories/automations.repository';
import {
  automationBlueprintSchema,
  blueprintRevision,
} from '../schemas/automation-blueprint.schema';

/** One entry of an automation's provision history (rollback source). */
export interface AutomationVersionEntry {
  version: number;
  blueprint: unknown;
  externalWorkflowId: string | null;
  provisionedAt: string;
}

/** Automation as exposed by the API. */
export interface AutomationView {
  id: string;
  name: string;
  description: string | null;
  blueprint: unknown;
  status: string;
  connectionId: string;
  externalWorkflowId: string | null;
  webhookPath: string | null;
  lastSyncedAt: Date | null;
  blueprintRevision: string | null;
  lastError: string | null;
  /** Incremented on every successful provision (§28). */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const PROVISIONABLE_STATUSES: readonly AutomationStatus[] = [
  AUTOMATION_STATUS.PENDING_APPROVAL,
  AUTOMATION_STATUS.FAILED,
] as const;

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly repository: AutomationsRepository,
    private readonly provisioner: N8nProvisionerService,
    private readonly connections: N8nConnectionsService,
    @Optional() private readonly nodeInventory?: N8nNodeInventoryService,
  ) {}

  /**
   * Persists an approved blueprint. Provisioning is reachable ONLY through
   * approve()/reprovision() — never directly from here.
   */
  async createFromBlueprint(
    dto: CreateAutomationFromBlueprintDto,
    scope: OwnerScope,
  ): Promise<AutomationView> {
    const blueprint = automationBlueprintSchema.parse(dto.blueprint);
    const connectionId = dto.connectionId ?? (await this.repository.findActiveConnectionId(scope));
    if (!connectionId) {
      throw new NotFoundException(
        'No ACTIVE n8n connection found. Connect an n8n instance before approving an automation.',
      );
    }
    const created = await this.repository.create({
      name: dto.name,
      description: dto.description ?? (blueprint.description || null),
      blueprint: blueprint as unknown as never,
      status: AUTOMATION_STATUS.PENDING_APPROVAL,
      connection: { connect: { id: connectionId } },
      ...(scope.userId ? { user: { connect: { id: scope.userId } } } : {}),
      ...(scope.organizationId ? { organization: { connect: { id: scope.organizationId } } } : {}),
    });
    return this.toView(created);
  }

  async list(scope: OwnerScope): Promise<AutomationView[]> {
    const rows = await this.repository.list(scope);
    return rows.map((row) => this.toView(row));
  }

  async findById(id: string, scope: OwnerScope): Promise<AutomationView> {
    return this.toView(await this.getOwned(id, scope));
  }

  /**
   * Approval gate: only PENDING_APPROVAL automations can transition to
   * PROVISIONING. The blueprint becomes immutable here.
   */
  async approve(id: string, scope: OwnerScope): Promise<AutomationView> {
    const automation = await this.getOwned(id, scope);
    this.assertProvisionable(automation);
    return this.provision(automation);
  }

  /** Re-push the stored blueprint to n8n (drift repair / failure retry). */
  async reprovision(id: string, scope: OwnerScope): Promise<AutomationView> {
    const automation = await this.getOwned(id, scope);
    if (
      automation.status !== AUTOMATION_STATUS.ACTIVE &&
      !PROVISIONABLE_STATUSES.includes(automation.status as AutomationStatus)
    ) {
      throw new Error(`Automation "${id}" in status ${automation.status} cannot be reprovisioned`);
    }
    return this.provision(automation);
  }

  /**
   * Replaces the stored blueprint (repair flow) and returns the row to
   * PENDING_APPROVAL — provisioning stays reachable only via approve().
   */
  async updateBlueprint(
    id: string,
    blueprint: Record<string, unknown>,
    scope: OwnerScope,
  ): Promise<AutomationView> {
    const automation = await this.getOwned(id, scope);
    const parsed = automationBlueprintSchema.parse(blueprint);
    const updated = await this.repository.update(automation.id, {
      blueprint: parsed as never,
      status: AUTOMATION_STATUS.PENDING_APPROVAL,
      lastError: null,
    });
    return this.toView(updated);
  }

  /**
   * Roll back to a previous provisioned version (§28): the history entry's
   * blueprint is restored and re-provisioned as a NEW version (history is
   * append-only — rollback never rewrites the past).
   */
  async rollbackToVersion(id: string, version: number, scope: OwnerScope): Promise<AutomationView> {
    const automation = await this.getOwned(id, scope);
    const history = this.readHistory(automation.blueprintHistory);
    const entry = history.find((item) => item.version === version);
    if (!entry) {
      const available = history.map((item) => item.version).join(', ') || 'none';
      throw new NotFoundException(
        `Automation "${id}" has no provisioned version ${version} (available: ${available})`,
      );
    }
    const restored = await this.repository.update(automation.id, {
      blueprint: entry.blueprint as never,
      status: AUTOMATION_STATUS.PENDING_APPROVAL,
      lastError: null,
    });
    return this.provision(restored);
  }

  /** Provision history (oldest first), tolerant of legacy rows. */
  history(id: string, scope: OwnerScope): Promise<AutomationVersionEntry[]> {
    return this.getOwned(id, scope).then((automation) =>
      this.readHistory(automation.blueprintHistory),
    );
  }

  async softDelete(id: string, scope: OwnerScope): Promise<AutomationView> {
    await this.getOwned(id, scope);
    return this.toView(await this.repository.softDelete(id));
  }

  /**
   * ACTIVE automations joined to their connection for runtime tool
   * resolution (PLAN Step 10). Includes automations whose connection is not
   * usable so the runtime can surface INTEGRATION_UNAVAILABLE instead of
   * silently dropping them.
   */
  async listForToolResolution(scope: OwnerScope) {
    return this.repository.listActiveWithConnection(scope);
  }

  // ── internals ──────────────────────────────────────────────

  private async provision(
    automation: Awaited<ReturnType<AutomationsRepository['findById']>> & object,
  ): Promise<AutomationView> {
    const blueprint = automationBlueprintSchema.parse(automation.blueprint);
    await this.repository.update(automation.id, {
      status: AUTOMATION_STATUS.PROVISIONING,
      lastError: null,
    });

    const credentials = await this.connections.resolveCredentials(automation.connectionId);
    if (!credentials) {
      const failed = await this.repository.update(automation.id, {
        status: AUTOMATION_STATUS.FAILED,
        lastError: 'n8n connection is not ACTIVE — reconnect the client instance first',
      });
      this.logger.warn({
        event: 'n8n.automation_provision_failed',
        automationId: automation.id,
        reason: 'connection_inactive',
      });
      return this.toView(failed);
    }

    try {
      // Best-effort instance inventory: enables native node choice, credential
      // reuse and data-table id mapping. Provisioning works without it.
      let instance: Awaited<ReturnType<N8nNodeInventoryService['inventory']>> | undefined;
      try {
        instance = this.nodeInventory ? await this.nodeInventory.inventory(credentials) : undefined;
      } catch {
        instance = undefined;
      }
      const result = await this.provisioner.provision({
        automationId: automation.id,
        blueprint,
        connection: credentials,
        instance,
      });
      const nextVersion = (automation.version ?? 0) + 1;
      const active = await this.repository.update(automation.id, {
        status: AUTOMATION_STATUS.ACTIVE,
        externalWorkflowId: result.externalWorkflowId,
        webhookPath: result.webhookPath,
        lastSyncedAt: new Date(),
        lastError: null,
        version: nextVersion,
        blueprintHistory: [
          ...this.readHistory(automation.blueprintHistory),
          {
            version: nextVersion,
            blueprint: automation.blueprint,
            externalWorkflowId: result.externalWorkflowId,
            provisionedAt: new Date().toISOString(),
          },
        ] as never,
      });
      return this.toView(active);
    } catch (error) {
      const message =
        error instanceof N8nClientApiError
          ? `n8n provisioning failed (${error.code}): ${error.message}`
          : error instanceof Error
            ? error.message
            : 'n8n provisioning failed unexpectedly';
      const failed = await this.repository.update(automation.id, {
        status: AUTOMATION_STATUS.FAILED,
        lastError: message,
      });
      this.logger.warn({
        event: 'n8n.automation_provision_failed',
        automationId: automation.id,
        message,
      });
      return this.toView(failed);
    }
  }

  private assertProvisionable(automation: { id: string; status: string }): void {
    if (!PROVISIONABLE_STATUSES.includes(automation.status as AutomationStatus)) {
      throw new Error(
        `Automation "${automation.id}" in status ${automation.status} has not been approved for provisioning`,
      );
    }
  }

  private async getOwned(id: string, scope: OwnerScope) {
    const automation = await this.repository.findById(id, scope);
    if (!automation) throw new NotFoundException(`Automation "${id}" not found`);
    return automation;
  }

  private toView(automation: {
    id: string;
    name: string;
    description: string | null;
    blueprint: unknown;
    status: string;
    connectionId: string;
    externalWorkflowId: string | null;
    webhookPath: string | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
    version?: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): AutomationView {
    const revision = this.safeRevision(automation.blueprint);
    return {
      id: automation.id,
      name: automation.name,
      description: automation.description,
      blueprint: automation.blueprint,
      status: automation.status,
      connectionId: automation.connectionId,
      externalWorkflowId: automation.externalWorkflowId,
      webhookPath: automation.webhookPath,
      lastSyncedAt: automation.lastSyncedAt,
      blueprintRevision: revision,
      lastError: automation.lastError,
      version: automation.version ?? 1,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
    };
  }

  private readHistory(value: unknown): AutomationVersionEntry[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is AutomationVersionEntry =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as { version?: unknown }).version === 'number',
    );
  }

  private safeRevision(blueprint: unknown): string | null {
    try {
      return blueprintRevision(automationBlueprintSchema.parse(blueprint));
    } catch {
      return null;
    }
  }
}
