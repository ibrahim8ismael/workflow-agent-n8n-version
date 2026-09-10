import { Injectable } from '@nestjs/common';
import type { N8nClientConnection } from '../../../infrastructure/n8n/n8n-client-api.service';
import {
  N8nNodeInventoryService,
  N8nNodeSchemaError,
} from '../../../infrastructure/n8n/n8n-node-inventory.service';
import {
  type AutomationBlueprint,
  automationBlueprintSchema,
} from '../../automations/schemas/automation-blueprint.schema';
import {
  AutomationsService,
  type AutomationView,
} from '../../automations/services/automations.service';
import type { OwnerScope } from '../../integrations/n8n/repositories/n8n-connections.repository';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { AgentRunService } from '../../runs/agent-run.service';
import {
  AutomationPlanReviewService,
  type PlanReviewIssue,
} from './automation-plan-review.service';
import type { IntegrationCapability } from './integration-registry.service';

export interface BuilderValidationResult {
  valid: boolean;
  errors: PlanReviewIssue[];
  warnings: PlanReviewIssue[];
  coverage: Array<{ requirementId: string; field: string; required: boolean; stepIds: string[] }>;
  nodeTypes: string[];
  readinessBlockers: import('../../automations/constants/automation-readiness.constants').ReadinessBlocker[];
}

export interface BuilderInput {
  blueprint: AutomationBlueprint;
  scope: OwnerScope;
  runId?: string;
  requirements?: Array<{ id?: string; field: string; required: boolean }>;
  conditions?: string[];
  capabilities?: IntegrationCapability[];
  /**
   * Explicit generic-node request from understanding — suppresses the
   * native-first guardrail in review and static validation.
   */
  genericOverride?: { requested: boolean; type?: 'httpRequest' | 'code' };
  /**
   * Reprovision onto an existing automation row (repair flow) instead of
   * creating a new row — versions keep accumulating on the same automation.
   */
  automationId?: string;
}

export interface BuiltAutomation {
  automation: AutomationView;
  validation: BuilderValidationResult;
}

const NODE_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-zA-Z0-9.@_-]+$/;
/** Expression roots n8n always provides — anything else is flagged, not failed. */
const KNOWN_EXPRESSION_ROOTS = new Set([
  '$json',
  '$input',
  '$now',
  '$today',
  '$workflow',
  '$execution',
  '$vars',
  '$env',
  '$jmespath',
  '$node',
  '$',
  '$parameter',
  '$prevNode',
]);

/**
 * Workflow Builder + Static Validator (docs/Jaafar-improve.md §16–§19).
 *
 * Build order: plan review (no build without a valid plan) → static
 * validation (structure, node existence against the harvested inventory,
 * expression safety) → provision through AutomationsService (which owns
 * versioning) → artifacts recorded on the AgentRun. Rollback re-provisions
 * a prior automation version as a new version.
 */
@Injectable()
export class AutomationWorkflowBuilderService {
  constructor(
    private readonly review: AutomationPlanReviewService,
    private readonly automations: AutomationsService,
    private readonly agentRuns: AgentRunService,
    private readonly connections: N8nConnectionsService,
    private readonly nodeInventory: N8nNodeInventoryService,
  ) {}

  /** Full static validation without touching n8n. */
  async validateOnly(input: BuilderInput): Promise<BuilderValidationResult> {
    const blueprint = automationBlueprintSchema.parse(input.blueprint);
    const connection = await this.resolveConnection(input.scope);
    const instanceTypes = await this.listInstanceTypes(connection);
    const reviewed = this.review.review({
      blueprint,
      requirements: input.requirements,
      conditions: input.conditions,
      capabilities: input.capabilities,
      ...(instanceTypes ? { instanceNodeTypes: instanceTypes } : {}),
      ...(input.genericOverride ? { genericOverride: input.genericOverride } : {}),
    });
    const errors = [...reviewed.errors];
    const warnings = [...reviewed.warnings];

    this.validateTrigger(reviewed.blueprint, errors);
    const nodeTypes = await this.validateNodes(reviewed.blueprint, connection, errors, warnings, {
      capabilities: input.capabilities,
      ...(instanceTypes ? { instanceTypes } : {}),
      ...(input.genericOverride ? { genericOverride: input.genericOverride } : {}),
    });
    this.validateExpressions(reviewed.blueprint, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      coverage: reviewed.coverage,
      nodeTypes,
      readinessBlockers: reviewed.readinessBlockers,
    };
  }

  /**
   * Validates, provisions, versions, and records — or throws on REAL failures.
   *
   * Missing provider credentials (NEEDS_CREDENTIAL) are NOT failures: they
   * return a successful build with `buildable=true, readyToRun=false`.
   * Only static validation errors, n8n connection failures, workflow
   * creation/persistence failures, and structural provisioning failures throw.
   */
  async build(input: BuilderInput): Promise<BuiltAutomation> {
    const validation = await this.validateOnly(input);
    if (!validation.valid) {
      const details = validation.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
      throw new Error(`Automation plan failed static validation: ${details}`);
    }
    const blueprint = automationBlueprintSchema.parse(input.blueprint);
    const created = input.automationId
      ? await this.automations.updateBlueprint(
          input.automationId,
          blueprint as unknown as Record<string, unknown>,
          input.scope,
        )
      : await this.automations.createFromBlueprint(
          {
            name: blueprint.name,
            description: blueprint.description || blueprint.summary,
            blueprint: blueprint as unknown as Record<string, unknown>,
          },
          input.scope,
        );
    const provisioned = await this.automations.approve(created.id, input.scope);
    if (provisioned.status === 'FAILED') {
      throw new Error(
        provisioned.lastError ?? 'Automation provisioning failed in the client n8n instance',
      );
    }
    // Credential blockers are successful builds that are not yet runnable —
    // do NOT throw when `readyToRun=false`.
    if (input.runId) {
      const readyNote = provisioned.readyToRun
        ? `automation provisioned (workflow v${provisioned.version})`
        : `automation built but awaiting credentials (workflow v${provisioned.version})`;
      await this.agentRuns.recordArtifacts(
        input.runId,
        {
          automationPlan: blueprint as never,
          validationResult: {
            valid: true,
            warnings: validation.warnings,
            coverage: validation.coverage,
            readinessBlockers: provisioned.readinessBlockers,
          } as never,
          executionResults: {
            automationId: provisioned.id,
            externalWorkflowId: provisioned.externalWorkflowId,
            webhookPath: provisioned.webhookPath,
            automationVersion: provisioned.version,
            buildable: provisioned.buildable,
            readyToRun: provisioned.readyToRun,
            readinessBlockers: provisioned.readinessBlockers,
          } as never,
          workflowId: provisioned.externalWorkflowId,
          workflowVersion: provisioned.version,
        },
        readyNote,
      );
    }
    return { automation: provisioned, validation };
  }

  /** Rolls back to a previous provisioned version (as a new version). */
  async rollback(
    automationId: string,
    version: number,
    scope: OwnerScope,
    runId?: string,
  ): Promise<AutomationView> {
    const rolledBack = await this.automations.rollbackToVersion(automationId, version, scope);
    if (rolledBack.status === 'FAILED') {
      throw new Error(rolledBack.lastError ?? 'Automation rollback failed in n8n');
    }
    if (runId) {
      await this.agentRuns.recordArtifacts(
        runId,
        {
          workflowId: rolledBack.externalWorkflowId,
          workflowVersion: rolledBack.version,
          executionResults: {
            externalWorkflowId: rolledBack.externalWorkflowId,
            webhookPath: rolledBack.webhookPath,
            automationVersion: rolledBack.version,
            rolledBackFrom: version,
          } as never,
        },
        `automation rolled back to v${version} (now v${rolledBack.version})`,
      );
    }
    return rolledBack;
  }

  // ── internals ──────────────────────────────────────────────

  private async resolveConnection(scope: OwnerScope): Promise<N8nClientConnection | null> {
    try {
      const resolved = await this.connections.resolveActiveForScope(scope);
      if (!resolved) return null;
      return { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
    } catch {
      return null;
    }
  }

  private validateTrigger(blueprint: AutomationBlueprint, errors: PlanReviewIssue[]): void {
    const trigger = blueprint.trigger;
    if (!trigger?.type) {
      errors.push({ code: 'MISSING_TRIGGER', message: 'Automation has no trigger' });
      return;
    }
    if (trigger.type === 'schedule') {
      // A hinted scheduleTrigger node carries the real schedule — the
      // blueprint-level config only matters when the provisioner generates it.
      const hasHintedSchedule = blueprint.steps.some(
        (step) => step.nodeHint?.type === 'n8n-nodes-base.scheduleTrigger',
      );
      if (hasHintedSchedule) return;
      const config = trigger.config ?? {};
      if (typeof config.cron !== 'string' && typeof config.every !== 'number') {
        errors.push({
          code: 'INVALID_PLAN',
          message:
            'Schedule triggers need config.cron (e.g. "0 9 * * *") or config.every + config.unit — describe the interval in a machine-readable way, not prose',
        });
      }
    }
  }

  /**
   * Every step must resolve to a real node: steps without a nodeHint fall
   * back to HTTP/Code skeletons at provisioning (warning, not error).
   * Malformed node types are hard errors. Inventory-unknown node types are
   * hard errors UNLESS the step references a known provider and the hint is
   * a plausible native node for it (e.g. gmail → gmailTrigger): in that case
   * the missing inventory observation is likely caused by never-connected
   * credentials, not hallucination — retain the node with a verification
   * warning and let n8n validate at createWorkflow(). A generic HTTP/Code
   * pick for a connected integration with a proven native node is also a
   * hard error — unless review already reported it for this step
   * (intra-call dedup) or the user explicitly requested the generic node.
   */
  private async validateNodes(
    blueprint: AutomationBlueprint,
    connection: N8nClientConnection | null,
    errors: PlanReviewIssue[],
    warnings: PlanReviewIssue[],
    opts: {
      capabilities?: IntegrationCapability[];
      instanceTypes?: string[];
      genericOverride?: { requested: boolean; type?: 'httpRequest' | 'code' };
    } = {},
  ): Promise<string[]> {
    const nodeTypes: string[] = [];
    for (const step of blueprint.steps) {
      const stepId = step.id ?? step.name;
      const hint = step.nodeHint;
      if (!hint) {
        warnings.push({
          code: 'UNMAPPED_STEP',
          message: `Step "${step.name}" has no node choice — provisions as HTTP/Code fallback`,
          stepId,
        });
        continue;
      }
      if (!NODE_TYPE_PATTERN.test(hint.type)) {
        errors.push({
          code: 'INVALID_PLAN',
          message: `Step "${step.name}" has a malformed node type "${hint.type}"`,
          stepId,
        });
        continue;
      }
      if (this.isProvenNativeViolation(step, hint.type, errors, opts)) continue;
      nodeTypes.push(hint.type);
      if (!connection) {
        warnings.push({
          code: 'UNMAPPED_STEP',
          message: `Step "${step.name}" node "${hint.type}" could not be verified (no n8n connection)`,
          stepId,
        });
        continue;
      }
      try {
        await this.nodeInventory.describeNodeType(connection, hint.type);
      } catch (error) {
        if (error instanceof N8nNodeSchemaError) {
          errors.push({
            code: 'INVALID_PLAN',
            message: `Step "${step.name}": ${error.message}`,
            stepId,
          });
        } else {
          warnings.push({
            code: 'UNMAPPED_STEP',
            message: `Step "${step.name}" node "${hint.type}" could not be verified`,
            stepId,
          });
        }
      }
    }
    return [...new Set(nodeTypes)];
  }

  private async listInstanceTypes(
    connection: N8nClientConnection | null,
  ): Promise<string[] | null> {
    if (!connection) return null;
    try {
      const inventory = await this.nodeInventory.inventory(connection);
      return inventory.nodeTypes.map((node) => node.type);
    } catch {
      return null;
    }
  }

  /**
   * Backstop native-first check. Returns true when the step was handled
   * here (violation recorded — caller must skip further checks for it).
   * Review owns NATIVE_NODE_AVAILABLE: if it already flagged this step in
   * the same validateOnly() pass, this backstop stays silent (dedup).
   */
  private isProvenNativeViolation(
    step: AutomationBlueprint['steps'][number],
    hintType: string,
    errors: PlanReviewIssue[],
    opts: {
      capabilities?: IntegrationCapability[];
      instanceTypes?: string[];
      genericOverride?: { requested: boolean; type?: 'httpRequest' | 'code' };
    },
  ): boolean {
    const GENERIC = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.code']);
    if (!GENERIC.has(hintType) || !step.integration) return false;
    const stepId = step.id ?? step.name;
    if (errors.some((error) => error.code === 'NATIVE_NODE_AVAILABLE' && error.stepId === stepId)) {
      return true; // review already owns this violation
    }
    const override = opts.genericOverride;
    if (override?.requested) {
      if (!override.type) return false;
      if (override.type === 'httpRequest' && hintType === 'n8n-nodes-base.httpRequest')
        return false;
      if (override.type === 'code' && hintType === 'n8n-nodes-base.code') return false;
    }
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const suffixOf = (nodeType: string): string => {
      const dot = nodeType.lastIndexOf('.');
      return normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
    };
    const provider = step.integration.toLowerCase();
    const capability = (opts.capabilities ?? []).find((c) => c.provider.toLowerCase() === provider);
    const connected = capability?.credentialsAvailable === true;
    const nativeIn = (types: string[] | undefined): string | undefined =>
      (types ?? []).find((type) => !GENERIC.has(type) && suffixOf(type) === normalize(provider));
    const proven =
      connected && Boolean(nativeIn(capability?.nodeTypes) ?? nativeIn(opts.instanceTypes));
    if (!proven) return false;
    const nativeType =
      nativeIn(capability?.nodeTypes) ?? nativeIn(opts.instanceTypes) ?? 'the native node';
    errors.push({
      code: 'INVALID_PLAN',
      message: `Step "${step.name}" uses ${hintType} for connected integration "${step.integration}" but the connected n8n instance provides the native ${nativeType} — replace it unless the user explicitly requested it`,
      stepId,
    });
    return true;
  }

  /**
   * Expression safety (§18): balanced {{ }} delimiters; $('name')/$node
   * references resolve to the trigger or a step defined EARLIER in the
   * chain (forward references always fail at runtime); unknown $roots warn.
   *
   * Delimiters are counted inside STRING leaves only — counting them in the
   * raw JSON would mistake structural braces (`"options":{}}}`) for
   * expression closers. A lone `}` with no `{{` is treated as literal text.
   */
  private validateExpressions(
    blueprint: AutomationBlueprint,
    errors: PlanReviewIssue[],
    warnings: PlanReviewIssue[],
  ): void {
    const stepNames = blueprint.steps.map((step) => step.name);
    blueprint.steps.forEach((step, index) => {
      const stepId = step.id ?? step.name;
      const sources: Array<[string, unknown]> = [
        ['nodeHint.parameters', step.nodeHint?.parameters],
        ['trigger.config', index === 0 ? blueprint.trigger.config : undefined],
      ];
      for (const [source, value] of sources) {
        if (value === undefined) continue;
        const strings = this.stringLeaves(value);
        for (const text of strings) {
          const opens = (text.match(/\{\{/g) ?? []).length;
          const closes = (text.match(/\}\}/g) ?? []).length;
          if (opens > 0 && opens !== closes) {
            errors.push({
              code: 'INVALID_PLAN',
              message: `Step "${step.name}" ${source} has unbalanced expression delimiters`,
              stepId,
            });
          }
        }
        const text = strings.join('\n');
        for (const match of text.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          this.checkNodeReference(match[1], stepNames, index, stepId, errors);
        }
        for (const match of text.matchAll(/\$node\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
          this.checkNodeReference(match[1], stepNames, index, stepId, errors);
        }
        for (const match of text.matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)) {
          const root = `$${match[1]}`;
          if (root === '$node') continue; // bare $node handled via $node["…"] above
          if (!KNOWN_EXPRESSION_ROOTS.has(root)) {
            warnings.push({
              code: 'UNMAPPED_STEP',
              message: `Step "${step.name}" ${source} uses unknown expression root "${root}"`,
              stepId,
            });
          }
        }
      }
    });
  }

  /** All string leaves of a parameter tree (expression carriers). */
  private stringLeaves(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((item) => this.stringLeaves(item));
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).flatMap((item) =>
        this.stringLeaves(item),
      );
    }
    return [];
  }

  private checkNodeReference(
    name: string,
    stepNames: string[],
    stepIndex: number,
    stepId: string,
    errors: PlanReviewIssue[],
  ): void {
    const targetIndex = stepNames.indexOf(name);
    if (targetIndex === -1) {
      // Trigger/respond nodes are provisioner-generated; anything else
      // unknown is a dangling reference. Note step ids (S1, …) are NOT node
      // names — expressions must use the step name from the plan.
      if (!/^(webhook|schedule|manual|respond|trigger)/i.test(name)) {
        errors.push({
          code: 'INVALID_PLAN',
          message: `Step references unknown node "${name}" (reference earlier steps by their plan name, not by id)`,
          stepId,
        });
      }
      return;
    }
    if (targetIndex >= stepIndex) {
      errors.push({
        code: 'INVALID_PLAN',
        message: `Step references "${name}", which runs later in the chain`,
        stepId,
      });
    }
  }
}
