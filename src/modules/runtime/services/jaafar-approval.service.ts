import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ApprovalEvaluation,
  ApprovalRequirement,
  ApprovalStatus,
} from '../interfaces/approval.interface';
import type { ToolDefinition } from '../interfaces/tool.interface';

export class ApprovalRequiredError extends Error {
  readonly code = 'APPROVAL_REQUIRED' as const;

  constructor(readonly reason: string) {
    super(reason);
    this.name = ApprovalRequiredError.name;
  }
}

export class ApprovalRejectedError extends Error {
  readonly code = 'PERMISSION_DENIED' as const;

  constructor(readonly reason: string) {
    super(reason);
    this.name = ApprovalRejectedError.name;
  }
}

@Injectable()
export class JaafarApprovalService {
  constructor(private readonly config: ConfigService) {}

  evaluate(tool: ToolDefinition, args: unknown): ApprovalEvaluation {
    const readOnly = this.isReadOnly(tool);
    const requirement = this.requirement(tool, args, readOnly);
    return { tool, requirement, readOnly };
  }

  assertExecutionAllowed(evaluation: ApprovalEvaluation, status: ApprovalStatus): void {
    if (!evaluation.requirement.required) return;
    if (status === 'pending' || status === 'not_required') {
      throw new ApprovalRequiredError(
        evaluation.requirement.reason ?? 'This action requires approval before execution.',
      );
    }
    if (status === 'rejected') {
      throw new ApprovalRejectedError('This action was rejected and cannot be executed.');
    }
    if (status !== 'approved') {
      throw new ApprovalRequiredError(
        'This action requires an approved decision before execution.',
      );
    }
  }

  private requirement(tool: ToolDefinition, args: unknown, readOnly: boolean): ApprovalRequirement {
    if (tool.requiresApproval || tool.sideEffect === true) {
      return { required: true, reason: `Tool "${tool.name}" can cause a side effect.` };
    }
    if (this.alwaysRequireApproval().has(tool.id) || this.alwaysRequireApproval().has(tool.slug)) {
      return { required: true, reason: `Tool "${tool.name}" is configured to require approval.` };
    }
    if (!readOnly && this.hasRiskyArguments(args)) {
      return { required: true, reason: `Tool "${tool.name}" has arguments that require approval.` };
    }
    return { required: false };
  }

  private isReadOnly(tool: ToolDefinition): boolean {
    return (
      tool.sideEffect !== true &&
      !tool.requiresApproval &&
      (tool.executionMode === 'knowledge' || tool.executionMode === 'memory')
    );
  }

  private alwaysRequireApproval(): Set<string> {
    const configured = this.config.get<string>('JAAFAR_APPROVAL_REQUIRED_TOOLS', '');
    return new Set(
      configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  private hasRiskyArguments(args: unknown): boolean {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
    return Object.entries(args).some(([key, value]) => {
      if (
        !/^(delete|destroy|remove|send|write|create|update|execute|publish|transfer)$/i.test(key)
      ) {
        return false;
      }
      return value === true || (typeof value === 'string' && value.trim().length > 0);
    });
  }
}
