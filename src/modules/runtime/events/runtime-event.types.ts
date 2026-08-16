import type { JsonValue } from '../interfaces/tool.interface';
import type { RuntimeError, RuntimeEventName, RuntimeUsage } from '../types/runtime-contract.types';

export interface RuntimeSseEventBase {
  type: RuntimeEventName;
  runId: string;
  occurredAt: string;
}

export type RuntimeSseEvent =
  | (RuntimeSseEventBase & { type: 'run.started'; status: 'CREATED' })
  | (RuntimeSseEventBase & { type: 'graph.node.started'; node: string })
  | (RuntimeSseEventBase & {
      type: 'graph.node.completed';
      node: string;
      durationMs: number;
    })
  | (RuntimeSseEventBase & {
      type: 'plan.created';
      stepCount: number;
      requiresApproval: boolean;
    })
  | (RuntimeSseEventBase & { type: 'approval.required'; reason: string })
  | (RuntimeSseEventBase & {
      type: 'tool.started';
      callId: string;
      toolName: string;
      args?: JsonValue;
    })
  | (RuntimeSseEventBase & {
      type: 'tool.completed';
      callId: string;
      toolName: string;
      durationMs: number;
      result?: JsonValue;
    })
  | (RuntimeSseEventBase & {
      type: 'tool.failed';
      callId: string;
      toolName: string;
      error: RuntimeError;
    })
  | (RuntimeSseEventBase & { type: 'token'; content: string })
  | (RuntimeSseEventBase & {
      type: 'run.waiting';
      reason: 'clarification' | 'approval';
    })
  | (RuntimeSseEventBase & {
      type: 'run.completed';
      response: string;
      usage: RuntimeUsage;
    })
  | (RuntimeSseEventBase & { type: 'run.failed'; error: RuntimeError })
  | (RuntimeSseEventBase & { type: 'run.cancelled'; reason?: string });

export type GraphRuntimeEvent =
  | { type: 'run.started'; occurredAt?: string }
  | { type: 'graph.node.started'; node: string; occurredAt?: string }
  | {
      type: 'graph.node.completed';
      node: string;
      durationMs: number;
      occurredAt?: string;
    }
  | {
      type: 'plan.created';
      stepCount: number;
      requiresApproval: boolean;
      occurredAt?: string;
    }
  | { type: 'approval.required'; reason: string; occurredAt?: string }
  | {
      type: 'tool.started';
      callId: string;
      toolName: string;
      args?: unknown;
      occurredAt?: string;
    }
  | {
      type: 'tool.completed';
      callId: string;
      toolName: string;
      durationMs: number;
      result?: unknown;
      occurredAt?: string;
    }
  | {
      type: 'tool.failed';
      callId: string;
      toolName: string;
      error: RuntimeError;
      occurredAt?: string;
    }
  | { type: 'token'; content: string; occurredAt?: string }
  | {
      type: 'run.waiting';
      reason: 'clarification' | 'approval';
      occurredAt?: string;
    }
  | {
      type: 'run.completed';
      response: string;
      usage: RuntimeUsage;
      occurredAt?: string;
    }
  | { type: 'run.failed'; error: RuntimeError; occurredAt?: string }
  | { type: 'run.cancelled'; reason?: string; occurredAt?: string };
