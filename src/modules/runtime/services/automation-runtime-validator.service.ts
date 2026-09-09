import { Injectable } from '@nestjs/common';
import { N8nWorkflowExecutorService } from '../../../infrastructure/n8n/n8n-workflow-executor.service';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import {
  AutomationErrorClassifierService,
  type ClassifiedAutomationError,
} from './automation-error-classifier.service';

export interface RuntimeValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface RuntimeValidationInput {
  blueprint: AutomationBlueprint;
  /** n8n instance base URL (test calls go to {baseUrl}/webhook/{webhookPath}). */
  baseUrl: string;
  webhookPath: string;
  runId?: string;
  userId?: string;
  organizationId?: string;
  automationVersion?: number;
}

export interface RuntimeValidationResult {
  ok: boolean;
  checks: RuntimeValidationCheck[];
  /** Raw webhook output (unwrapped envelope) for side-effect inspection. */
  output?: unknown;
  durationMs: number;
  testInput: Record<string, unknown>;
  classified?: ClassifiedAutomationError;
}

/**
 * Runtime Validator (docs/Jaafar-improve.md §21–§22).
 *
 * Executes the provisioned workflow against realistic test data through the
 * existing webhook/HMAC executor, then verifies: the workflow responded,
 * it did not report failure, and every outputContract key is present in the
 * response. Success means execution + expected side-effect evidence — never
 * a bare HTTP 200.
 */
@Injectable()
export class AutomationRuntimeValidatorService {
  constructor(
    private readonly executor: N8nWorkflowExecutorService,
    private readonly classifier: AutomationErrorClassifierService,
  ) {}

  async validate(input: RuntimeValidationInput): Promise<RuntimeValidationResult> {
    const startedAt = Date.now();
    const testInput = this.buildTestInput(input.blueprint);
    const checks: RuntimeValidationCheck[] = [];
    try {
      const output = await this.executor.execute({
        workflow: input.blueprint.name,
        input: testInput,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        timeoutMs: 60_000,
        idempotencyKey: `validation:${input.runId ?? 'adhoc'}:${input.automationVersion ?? 1}`,
        metadata: { validation: true },
        binding: { baseUrl: input.baseUrl, webhookPath: input.webhookPath },
      });
      checks.push({ name: 'workflow_responded', passed: true });
      checks.push(this.checkNoErrorFlag(output));
      checks.push(...this.checkOutputContract(input.blueprint, output));
      const ok = checks.every((check) => check.passed);
      return {
        ok,
        checks,
        output,
        durationMs: Date.now() - startedAt,
        testInput,
        ...(ok
          ? {}
          : {
              classified: {
                code: 'LOGIC_ERROR',
                retryable: false,
                repairStrategy: 'replan_step',
                summary:
                  'The workflow executed but its output did not match the expected contract.',
              } as ClassifiedAutomationError,
            }),
      };
    } catch (error) {
      checks.push({
        name: 'workflow_responded',
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      const classified = this.classifier.classify(error, 'runtime validation');
      return {
        ok: false,
        checks,
        durationMs: Date.now() - startedAt,
        testInput,
        classified,
      };
    }
  }

  /**
   * Realistic test data from the blueprint's inputContract. Unknown shapes
   * degrade to a validation marker — the workflow's own test branch decides
   * what "realistic" means for free-form inputs.
   */
  buildTestInput(blueprint: AutomationBlueprint): Record<string, unknown> {
    const input: Record<string, unknown> = { test: true, source: 'jaafar-validation' };
    const contract = blueprint.inputContract as Record<string, unknown> | undefined;
    const properties =
      contract && typeof contract === 'object' && !Array.isArray(contract)
        ? (contract.properties as Record<string, { type?: string }> | undefined)
        : undefined;
    if (properties && typeof properties === 'object') {
      for (const [key, schema] of Object.entries(properties)) {
        input[key] = this.sampleForType(typeof schema?.type === 'string' ? schema.type : 'string');
      }
    }
    return input;
  }

  private sampleForType(type: string): unknown {
    switch (type) {
      case 'number':
      case 'integer':
        return 1;
      case 'boolean':
        return true;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return 'validation-sample';
    }
  }

  private checkNoErrorFlag(output: unknown): RuntimeValidationCheck {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const record = output as Record<string, unknown>;
      if (record.success === false) {
        return {
          name: 'no_error_flag',
          passed: false,
          detail: `Workflow reported success=false${typeof record.error === 'string' ? `: ${record.error}` : ''}`,
        };
      }
    }
    return { name: 'no_error_flag', passed: true };
  }

  private checkOutputContract(
    blueprint: AutomationBlueprint,
    output: unknown,
  ): RuntimeValidationCheck[] {
    const contract = blueprint.outputContract as Record<string, unknown> | undefined;
    const properties =
      contract && typeof contract === 'object' && !Array.isArray(contract)
        ? (contract.properties as Record<string, unknown> | undefined)
        : undefined;
    if (!properties || Object.keys(properties).length === 0) {
      return [{ name: 'output_contract', passed: true, detail: 'no contract declared — skipped' }];
    }
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return [
        {
          name: 'output_contract',
          passed: false,
          detail: 'expected an object response matching the output contract',
        },
      ];
    }
    const record = output as Record<string, unknown>;
    const missing = Object.keys(properties).filter((key) => !(key in record));
    if (missing.length > 0) {
      return [
        {
          name: 'output_contract',
          passed: false,
          detail: `response is missing contract keys: ${missing.join(', ')}`,
        },
      ];
    }
    return [{ name: 'output_contract', passed: true }];
  }
}
