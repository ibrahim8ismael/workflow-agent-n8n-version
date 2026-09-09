import { Injectable } from '@nestjs/common';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import type { IntegrationCapability } from './integration-registry.service';

export type PlanReviewErrorCode =
  | 'INVALID_PLAN'
  | 'MISSING_TRIGGER'
  | 'NO_STEPS'
  | 'DUPLICATE_STEP'
  | 'UNCOVERED_REQUIREMENT'
  | 'UNKNOWN_INTEGRATION'
  | 'NATIVE_NODE_AVAILABLE';

export interface PlanReviewIssue {
  code:
    | PlanReviewErrorCode
    | 'UNMAPPED_STEP'
    | 'CONDITION_UNREPRESENTED'
    | 'SIDE_EFFECT_UNACKNOWLEDGED';
  message: string;
  stepId?: string;
  requirementId?: string;
}

export interface RequirementCoverage {
  requirementId: string;
  field: string;
  required: boolean;
  stepIds: string[];
}

export interface PlanReviewInput {
  blueprint: AutomationBlueprint;
  /** Required requirements with stable R-ids (from understanding v2). */
  requirements?: Array<{ id?: string; field: string; required: boolean }>;
  /** Conditions extracted from the request (understanding v2). */
  conditions?: string[];
  /** Registry capabilities — integration refs validated when provided. */
  capabilities?: IntegrationCapability[];
  /**
   * Instance node types for native-availability proof. When absent the
   * native check degrades to capability-observed types (error) or a
   * warning — never a false hard error.
   */
  instanceNodeTypes?: string[];
  /** Explicit generic-node request from understanding — suppresses the native guard. */
  genericOverride?: { requested: boolean; type?: 'httpRequest' | 'code' };
}

export interface PlanReviewResult {
  blueprint: AutomationBlueprint;
  valid: boolean;
  errors: PlanReviewIssue[];
  warnings: PlanReviewIssue[];
  coverage: RequirementCoverage[];
}

const SIDE_EFFECT_PATTERN = /(delete|remove|destroy|charge|payment|refund|send money|transfer)/i;

/**
 * Plan Review (docs/Jaafar-improve.md §15 + §20).
 *
 * Validates an automation plan BEFORE anything is built: trigger, steps,
 * requirement→step coverage, integration existence. Returns the blueprint
 * with stable step ids (S1, S2, …) assigned. The workflow builder refuses
 * to build an invalid plan — no build without a valid plan.
 */
@Injectable()
export class AutomationPlanReviewService {
  review(input: PlanReviewInput): PlanReviewResult {
    const blueprint = this.assignStepIds(input.blueprint);
    const errors: PlanReviewIssue[] = [];
    const warnings: PlanReviewIssue[] = [];

    if (!blueprint.goal?.trim()) {
      errors.push({ code: 'INVALID_PLAN', message: 'Plan must have a goal' });
    }
    if (!blueprint.trigger?.type) {
      errors.push({ code: 'MISSING_TRIGGER', message: 'Plan must declare a trigger' });
    }
    if (blueprint.steps.length === 0) {
      errors.push({ code: 'NO_STEPS', message: 'Plan must contain at least one step' });
    }

    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const step of blueprint.steps) {
      const stepId = step.id ?? step.name;
      if (seenIds.has(step.id ?? '')) {
        errors.push({
          code: 'DUPLICATE_STEP',
          message: `Duplicate step id "${step.id}"`,
          stepId: step.id,
        });
      }
      seenIds.add(step.id ?? '');
      const normalizedName = step.name.trim().toLowerCase();
      if (seenNames.has(normalizedName)) {
        errors.push({
          code: 'DUPLICATE_STEP',
          message: `Duplicate step name "${step.name}"`,
          stepId,
        });
      }
      seenNames.add(normalizedName);
      if (!step.action?.trim()) {
        errors.push({ code: 'INVALID_PLAN', message: 'Every step needs an action', stepId });
      }
      if (!step.expectedOutput && !step.description) {
        warnings.push({
          code: 'UNMAPPED_STEP',
          message: `Step "${step.name}" has neither expectedOutput nor description`,
          stepId,
        });
      }
      if ((step.requirementIds ?? []).length === 0) {
        warnings.push({
          code: 'UNMAPPED_STEP',
          message: `Step "${step.name}" satisfies no requirement`,
          stepId,
        });
      }
    }

    const coverage = this.coverageMap(blueprint, input.requirements ?? []);
    for (const entry of coverage) {
      if (entry.required && entry.stepIds.length === 0) {
        errors.push({
          code: 'UNCOVERED_REQUIREMENT',
          message: `Required requirement "${entry.field}" (${entry.requirementId}) is not covered by any step`,
          requirementId: entry.requirementId,
        });
      }
    }

    if ((input.conditions ?? []).length > 0 && !blueprint.steps.some((s) => s.condition?.trim())) {
      warnings.push({
        code: 'CONDITION_UNREPRESENTED',
        message: 'The request states conditions but no step declares a condition gate',
      });
    }

    if (input.capabilities) {
      const providers = new Set(input.capabilities.map((c) => c.provider.toLowerCase()));
      const referenced = new Set<string>();
      for (const integration of blueprint.integrations ?? []) referenced.add(integration);
      for (const step of blueprint.steps) {
        if (step.integration) referenced.add(step.integration);
      }
      for (const name of referenced) {
        if (!providers.has(name.toLowerCase())) {
          errors.push({
            code: 'UNKNOWN_INTEGRATION',
            message: `Integration "${name}" is not connected — connect it before building`,
          });
        }
      }
    }

    this.checkNativeNodePreference(blueprint, input, errors, warnings);

    if (
      blueprint.steps.some((step) => SIDE_EFFECT_PATTERN.test(`${step.name} ${step.action}`)) &&
      (blueprint.riskNotes ?? []).length === 0
    ) {
      warnings.push({
        code: 'SIDE_EFFECT_UNACKNOWLEDGED',
        message: 'A step looks side-effecting but the plan records no risk notes',
      });
    }

    return { blueprint, valid: errors.length === 0, errors, warnings, coverage };
  }

  /**
   * Native-first guardrail: a generic HTTP/Code node for a connected
   * integration with a proven native node is an error
   * (NATIVE_NODE_AVAILABLE → replan); when availability cannot be proven
   * it degrades to a warning so unknown integrations never hard-fail.
   * An explicit user override suppresses the check entirely.
   */
  private checkNativeNodePreference(
    blueprint: AutomationBlueprint,
    input: PlanReviewInput,
    errors: PlanReviewIssue[],
    warnings: PlanReviewIssue[],
  ): void {
    const GENERIC = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.code']);
    const override = input.genericOverride;
    const overrideBlocks = (hintType: string): boolean => {
      if (!override?.requested) return false;
      if (!override.type) return true;
      if (override.type === 'httpRequest') return hintType === 'n8n-nodes-base.httpRequest';
      return hintType === 'n8n-nodes-base.code';
    };
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const suffixOf = (nodeType: string): string => {
      const dot = nodeType.lastIndexOf('.');
      return normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
    };
    const capabilities = input.capabilities ?? [];
    const instanceTypes = input.instanceNodeTypes ?? [];
    for (const step of blueprint.steps) {
      const stepId = step.id ?? step.name;
      const hintType = step.nodeHint?.type;
      if (!step.integration || !hintType || !GENERIC.has(hintType)) continue;
      if (overrideBlocks(hintType)) continue;
      const provider = step.integration.toLowerCase();
      const capability = capabilities.find((c) => c.provider.toLowerCase() === provider);
      const provenFromCapability =
        capability?.credentialsAvailable &&
        (capability.nodeTypes ?? []).some(
          (type) => !GENERIC.has(type) && suffixOf(type) === normalize(provider),
        );
      const provenNativeType =
        (capability?.nodeTypes ?? []).find(
          (type) => !GENERIC.has(type) && suffixOf(type) === normalize(provider),
        ) ??
        instanceTypes.find((type) => !GENERIC.has(type) && suffixOf(type) === normalize(provider));
      if (provenFromCapability || (capability?.credentialsAvailable && provenNativeType)) {
        errors.push({
          code: 'NATIVE_NODE_AVAILABLE',
          message: `Step "${step.name}" uses ${hintType} for connected integration "${step.integration}" but the connected n8n instance provides the native ${provenNativeType ?? 'node'} — replace it unless the user explicitly requested it`,
          stepId,
        });
      } else if (capability && (capability.suggestedNodeType || capability.credentialsAvailable)) {
        warnings.push({
          code: 'UNMAPPED_STEP',
          message: `Step "${step.name}" uses ${hintType} for connected integration "${step.integration}" — prefer the native node (${capability.suggestedNodeType ?? 'see instance inventory'}) unless the user asked otherwise`,
          stepId,
        });
      }
    }
  }

  /** Requirement → step coverage map (§20). */
  coverageMap(
    blueprint: AutomationBlueprint,
    requirements: Array<{ id?: string; field: string; required: boolean }>,
  ): RequirementCoverage[] {
    return requirements.map((requirement, index) => {
      const requirementId = requirement.id ?? `R${index + 1}`;
      const stepIds = blueprint.steps
        .filter((step) => (step.requirementIds ?? []).includes(requirementId))
        .map((step, stepIndex) => step.id ?? `S${stepIndex + 1}`);
      return { requirementId, field: requirement.field, required: requirement.required, stepIds };
    });
  }

  private assignStepIds(blueprint: AutomationBlueprint): AutomationBlueprint {
    let counter = 0;
    const used = new Set(
      blueprint.steps.map((step) => step.id).filter((id): id is string => Boolean(id)),
    );
    return {
      ...blueprint,
      steps: blueprint.steps.map((step) => {
        if (step.id) return step;
        do {
          counter += 1;
        } while (used.has(`S${counter}`));
        const id = `S${counter}`;
        used.add(id);
        return { ...step, id };
      }),
    };
  }
}
