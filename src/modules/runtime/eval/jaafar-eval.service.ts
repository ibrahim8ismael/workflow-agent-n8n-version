import { Injectable } from '@nestjs/common';
import {
  type AutomationBlueprint,
  automationBlueprintSchema,
} from '../../automations/schemas/automation-blueprint.schema';
import { AutomationErrorClassifierService } from '../services/automation-error-classifier.service';
import { AutomationPlanReviewService } from '../services/automation-plan-review.service';
import { AutomationWorkflowBuilderService } from '../services/automation-workflow-builder.service';
import { applyAssumptionPolicy, resolveClarification } from '../services/understanding-policy';
import { classifyApprovalReply } from '../shared/approval-reply';
import { type EvalDataset, type EvalScenario, evalDatasetSchema } from './eval-dataset.schema';
import datasetJson from './jaafar-eval-dataset.json';

export interface EvalCaseResult {
  id: string;
  category: string;
  passed: boolean;
  skipped: boolean;
  detail?: string;
}

export interface EvalReport {
  datasetVersion: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  byCategory: Record<string, { passed: number; failed: number; skipped: number }>;
  failures: EvalCaseResult[];
  results: EvalCaseResult[];
}

/**
 * Offline evaluation runner (docs/Jaafar-improve.md §31–§33, release gate §48).
 *
 * Executes every dataset scenario tagged with an `offline` case against the
 * REAL deterministic components (classifier, plan review, static validator,
 * assumption policy) — no LLM, no n8n. Live-only scenarios (offline: null)
 * are reported as skipped for manual/live runs. Runs in CI via `npm run eval`.
 */
@Injectable()
export class JaafarEvalService {
  constructor(
    private readonly classifier: AutomationErrorClassifierService,
    private readonly planReview: AutomationPlanReviewService,
    private readonly builder: AutomationWorkflowBuilderService,
  ) {}

  dataset(): EvalDataset {
    return evalDatasetSchema.parse(datasetJson);
  }

  async runOffline(): Promise<EvalReport> {
    const dataset = this.dataset();
    const results: EvalCaseResult[] = [];
    for (const scenario of dataset.scenarios) {
      results.push(await this.runScenario(scenario));
    }
    const failures = results.filter((r) => !r.passed && !r.skipped);
    const byCategory: EvalReport['byCategory'] = {};
    for (const result of results) {
      let entry = byCategory[result.category];
      if (!entry) {
        entry = { passed: 0, failed: 0, skipped: 0 };
        byCategory[result.category] = entry;
      }
      if (result.skipped) entry.skipped += 1;
      else if (result.passed) entry.passed += 1;
      else entry.failed += 1;
    }
    return {
      datasetVersion: dataset.version,
      total: results.length,
      passed: results.length - failures.length - results.filter((r) => r.skipped).length,
      failed: failures.length,
      skipped: results.filter((r) => r.skipped).length,
      byCategory,
      failures,
      results,
    };
  }

  private async runScenario(scenario: EvalScenario): Promise<EvalCaseResult> {
    const base = { id: scenario.id, category: scenario.category };
    if (!scenario.offline) {
      return { ...base, passed: true, skipped: true, detail: 'live-only scenario' };
    }
    try {
      switch (scenario.offline.kind) {
        case 'classify-error':
          return { ...base, passed: this.checkClassifyError(scenario), skipped: false };
        case 'review-plan':
          return { ...base, passed: this.checkReviewPlan(scenario), skipped: false };
        case 'validate-workflow': {
          const checked = await this.checkValidateWorkflow(scenario);
          return { ...base, passed: checked.passed, skipped: false, detail: checked.detail };
        }
        case 'assumption-policy':
          return { ...base, passed: this.checkAssumptionPolicy(scenario), skipped: false };
        case 'approval-reply':
          return { ...base, passed: this.checkApprovalReply(scenario), skipped: false };
      }
    } catch (error) {
      return {
        ...base,
        passed: false,
        skipped: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private checkClassifyError(scenario: EvalScenario): boolean {
    const offline = scenario.offline;
    if (offline?.kind !== 'classify-error') return false;
    const error =
      offline.statusCode !== undefined
        ? Object.assign(new Error(offline.message), { statusCode: offline.statusCode })
        : new Error(offline.message);
    const classified = this.classifier.classify(error, offline.stage ?? 'eval');
    if (classified.code !== offline.expectedCode) {
      throw new Error(`expected code ${offline.expectedCode}, got ${classified.code}`);
    }
    if (
      offline.expectedRetryable !== undefined &&
      classified.retryable !== offline.expectedRetryable
    ) {
      throw new Error(
        `expected retryable=${offline.expectedRetryable}, got ${classified.retryable}`,
      );
    }
    if (
      offline.expectedActionContains !== undefined &&
      !(classified.userAction ?? '').includes(offline.expectedActionContains)
    ) {
      throw new Error(
        `expected user action to contain "${offline.expectedActionContains}", got "${classified.userAction ?? '(none)'}"`,
      );
    }
    return true;
  }

  private checkReviewPlan(scenario: EvalScenario): boolean {
    const offline = scenario.offline;
    if (offline?.kind !== 'review-plan') return false;
    let blueprint: AutomationBlueprint;
    try {
      blueprint = automationBlueprintSchema.parse(offline.blueprint);
    } catch {
      if (offline.expectedValid)
        throw new Error('blueprint failed to parse but valid was expected');
      this.assertCodes(['INVALID_PLAN'], offline.expectedErrorCodes, scenario.id);
      return true;
    }
    const reviewed = this.planReview.review({
      blueprint,
      ...(offline.requirements ? { requirements: offline.requirements } : {}),
      ...(offline.conditions ? { conditions: offline.conditions } : {}),
      ...(offline.capabilities ? { capabilities: offline.capabilities as never } : {}),
      ...(offline.instanceNodeTypes ? { instanceNodeTypes: offline.instanceNodeTypes } : {}),
      ...(offline.genericOverride ? { genericOverride: offline.genericOverride } : {}),
    });
    if (reviewed.valid !== offline.expectedValid) {
      throw new Error(
        `expected valid=${offline.expectedValid}, got ${reviewed.valid} (${reviewed.errors.map((e) => e.code).join(',')})`,
      );
    }
    this.assertCodes(
      reviewed.errors.map((e) => e.code),
      offline.expectedErrorCodes,
      scenario.id,
    );
    this.assertCodes(
      reviewed.warnings.map((w) => w.code),
      offline.expectedWarningCodes,
      scenario.id,
    );
    return true;
  }

  private async checkValidateWorkflow(
    scenario: EvalScenario,
  ): Promise<{ passed: boolean; detail?: string }> {
    const offline = scenario.offline;
    if (offline?.kind !== 'validate-workflow') return { passed: false };
    let blueprint: AutomationBlueprint;
    try {
      blueprint = automationBlueprintSchema.parse(offline.blueprint);
    } catch {
      if (offline.expectedValid) {
        return { passed: false, detail: 'blueprint failed to parse but valid was expected' };
      }
      return { passed: (offline.expectedErrorCodes ?? ['INVALID_PLAN']).includes('INVALID_PLAN') };
    }
    const validation = await this.builder.validateOnly({
      blueprint,
      scope: {},
      requirements: offline.requirements,
      ...(offline.capabilities ? { capabilities: offline.capabilities as never } : {}),
    });
    if (validation.valid !== offline.expectedValid) {
      return {
        passed: false,
        detail: `expected valid=${offline.expectedValid}, got ${validation.valid} (${validation.errors.map((e) => e.message).join('; ')})`,
      };
    }
    const actual = validation.errors.map((e) => e.code);
    for (const expected of offline.expectedErrorCodes ?? []) {
      if (!actual.includes(expected as never)) {
        return { passed: false, detail: `expected error ${expected} not in [${actual.join(',')}]` };
      }
    }
    return { passed: true };
  }

  private checkAssumptionPolicy(scenario: EvalScenario): boolean {
    const offline = scenario.offline;
    if (offline?.kind !== 'assumption-policy') return false;
    const { confirmationsNeeded } = applyAssumptionPolicy(
      offline.assumptions.map((a) => ({ ...a, rationale: a.rationale ?? '' })),
    );
    const { required, question } = resolveClarification({
      clarificationRequired: false,
      missingInputs: (offline.missingInputs ?? []).map((m) => ({ ...m })),
      confirmationsNeeded,
    });
    if (required !== offline.expectedClarification) {
      throw new Error(`expected clarification=${offline.expectedClarification}, got ${required}`);
    }
    if (
      offline.expectedQuestionContains !== undefined &&
      !(question ?? '').includes(offline.expectedQuestionContains)
    ) {
      throw new Error(
        `expected question to contain "${offline.expectedQuestionContains}", got "${question ?? '(none)'}"`,
      );
    }
    return true;
  }

  private checkApprovalReply(scenario: EvalScenario): boolean {
    const offline = scenario.offline;
    if (offline?.kind !== 'approval-reply') return false;
    const decision = classifyApprovalReply(offline.message);
    if (decision !== offline.expectedDecision) {
      throw new Error(
        `expected decision ${offline.expectedDecision}, got ${decision} for ${JSON.stringify(offline.message)}`,
      );
    }
    return true;
  }

  private assertCodes(actual: string[], expected: string[] | undefined, id: string): void {
    for (const code of expected ?? []) {
      if (!actual.includes(code)) {
        throw new Error(`scenario ${id}: expected code ${code} not in [${actual.join(',')}]`);
      }
    }
  }
}
