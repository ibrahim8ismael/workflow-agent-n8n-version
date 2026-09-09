import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  type AutomationBlueprint,
  automationBlueprintSchema,
} from '../../automations/schemas/automation-blueprint.schema';
import type { ClassifiedAutomationError } from './automation-error-classifier.service';
import type { IntegrationCapability } from './integration-registry.service';

/** Repair budget per run (docs/Jaafar-improve.md §24). */
export const MAX_REPAIR_ATTEMPTS = 3;

export type RepairStage = 'provision' | 'test' | 'validate' | 'verify';

export interface RepairFailure {
  stage: RepairStage;
  message: string;
  classified: ClassifiedAutomationError;
  validationErrors?: string[];
}

export interface RepairAttemptRecord {
  attempt: number;
  at: string;
  stage: RepairStage;
  code: string;
  diagnosis: string;
  changes: string[];
  blueprintRevision: string;
}

export interface RepairInput {
  blueprint: AutomationBlueprint;
  failure: RepairFailure;
  requirements: Array<{ id?: string; field: string; required: boolean }>;
  conditions: string[];
  capabilities?: IntegrationCapability[];
  /** 1-based attempt number (must be ≤ MAX_REPAIR_ATTEMPTS). */
  attempt: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface RepairOutcome {
  blueprint: AutomationBlueprint;
  diagnosis: string;
  changes: string[];
  /** True when the fix is "retry unchanged" (transient failures). */
  retryUnchanged: boolean;
}

const repairSchema = z.object({
  diagnosis: z.string().min(1).max(1000),
  changes: z.array(z.string().min(1).max(300)).max(10),
  blueprint: automationBlueprintSchema,
});

/**
 * Self-Repair Engine (docs/Jaafar-improve.md §23–§24).
 *
 * Execution error → root-cause diagnosis → patched blueprint. The caller
 * (V2 graph) owns the loop: revalidate → reprovision → re-execute, persisting
 * each attempt and escalating after MAX_REPAIR_ATTEMPTS with the §42 UX.
 */
@Injectable()
export class AutomationRepairService {
  constructor(private readonly llmRuntime: LLMRuntimeService) {}

  /** Transient failures need no patch — retry the same blueprint. */
  needsPatch(classified: ClassifiedAutomationError): boolean {
    return classified.repairStrategy !== 'retry_execution';
  }

  async diagnoseAndPatch(input: RepairInput): Promise<RepairOutcome> {
    if (input.attempt < 1 || input.attempt > MAX_REPAIR_ATTEMPTS) {
      throw new Error(
        `Repair attempt ${input.attempt} is outside the 1–${MAX_REPAIR_ATTEMPTS} budget`,
      );
    }
    if (!this.needsPatch(input.failure.classified)) {
      return {
        blueprint: input.blueprint,
        diagnosis: `${input.failure.classified.summary} Classified as transient — retrying unchanged.`,
        changes: [],
        retryUnchanged: true,
      };
    }
    const result = await this.llmRuntime.generateObject({
      mode: input.effort ?? 'medium',
      systemPrompt: this.systemPrompt(input),
      messages: [{ role: 'user', content: this.userPrompt(input) }],
      schema: repairSchema,
      temperature: 0.2,
      maxTokens: 2500,
      timeoutMs: 60_000,
    });
    const parsed = repairSchema.parse(result.object);
    return {
      blueprint: parsed.blueprint,
      diagnosis: parsed.diagnosis,
      changes: parsed.changes,
      retryUnchanged: false,
    };
  }

  /**
   * Failure UX (§42): what succeeded, what failed, the exact blocker, the
   * required user action. Never "something went wrong".
   */
  escalationMessage(input: {
    automationName: string;
    succeeded: string[];
    failure: RepairFailure;
    attempts: RepairAttemptRecord[];
  }): string {
    const lines = [
      `I couldn't finish the automation "${input.automationName}".`,
      '',
      ...(input.succeeded.length > 0
        ? ['What works:', ...input.succeeded.map((item) => `- ${item}`), '']
        : []),
      'What failed:',
      `- ${input.failure.stage}: ${input.failure.classified.summary}`,
      '',
      `Blocker: ${input.failure.message}`,
      '',
      `Repair attempts: ${input.attempts.length}/${MAX_REPAIR_ATTEMPTS}` +
        (input.attempts.length > 0 ? ` (${input.attempts.map((a) => a.code).join(', ')})` : ''),
      '',
      input.failure.classified.userAction ??
        'Describe what changed on your side (or adjust the request) and I can try a different approach — nothing was provisioned in a broken state.',
    ];
    return lines.join('\n');
  }

  private systemPrompt(input: RepairInput): string {
    const capabilities = (input.capabilities ?? []).map(
      (capability) => `- ${capability.displayName} [${capability.connectionStatus}]`,
    );
    return [
      'You are Jaafar diagnosing a failed business automation. Find the root cause in the evidence and return a corrected COMPLETE blueprint — never a partial patch.',
      'Rules:',
      '- Keep every step that already works; change only what the failure explains.',
      '- Every step keeps a stable id and requirementIds; uncover no required requirement.',
      '- Use only connected integrations below; never invent node types, credentials, or operations.',
      '- Write the diagnosis for the operator (what broke, why) and list each change concretely.',
      '<connected_integrations>',
      capabilities.join('\n') || '(unknown)',
      '</connected_integrations>',
      `<requirements>\n${JSON.stringify(input.requirements)}\n</requirements>`,
      `<conditions>\n${JSON.stringify(input.conditions)}\n</conditions>`,
      `This is repair attempt ${input.attempt} of ${MAX_REPAIR_ATTEMPTS}.`,
    ].join('\n\n');
  }

  private userPrompt(input: RepairInput): string {
    return [
      `<failed_stage>${input.failure.stage}</failed_stage>`,
      `<error>${input.failure.message}</error>`,
      `<classification>${input.failure.classified.code}: ${input.failure.classified.summary}</classification>`,
      ...(input.failure.validationErrors?.length
        ? [
            `<validation_errors>\n${input.failure.validationErrors.join('\n')}\n</validation_errors>`,
          ]
        : []),
      `<current_blueprint>\n${JSON.stringify(input.blueprint)}\n</current_blueprint>`,
      'Return diagnosis, changes, and the corrected blueprint now.',
    ].join('\n');
  }
}
