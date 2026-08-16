import { Injectable } from '@nestjs/common';
import type { GraphRuntimeEvent, RuntimeSseEvent } from '../events/runtime-event.types';
import type { JsonValue } from '../interfaces/tool.interface';

const SENSITIVE_KEY =
  /^(authorization|password|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|credential|client[-_]?secret)$/i;

@Injectable()
export class JaafarEventNormalizerService {
  normalize(runId: string, event: GraphRuntimeEvent): RuntimeSseEvent {
    const base = {
      runId,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };

    switch (event.type) {
      case 'run.started':
        return { ...base, type: event.type, status: 'CREATED' };
      case 'graph.node.started':
        return { ...base, type: event.type, node: event.node };
      case 'graph.node.completed':
        return { ...base, type: event.type, node: event.node, durationMs: event.durationMs };
      case 'plan.created':
        return {
          ...base,
          type: event.type,
          stepCount: event.stepCount,
          requiresApproval: event.requiresApproval,
        };
      case 'approval.required':
        return { ...base, type: event.type, reason: event.reason };
      case 'tool.started':
        return {
          ...base,
          type: event.type,
          callId: event.callId,
          toolName: event.toolName,
          ...(event.args === undefined ? {} : { args: redactSensitive(event.args) }),
        };
      case 'tool.completed':
        return {
          ...base,
          type: event.type,
          callId: event.callId,
          toolName: event.toolName,
          durationMs: event.durationMs,
          ...(event.result === undefined ? {} : { result: redactSensitive(event.result) }),
        };
      case 'tool.failed':
        return {
          ...base,
          type: event.type,
          callId: event.callId,
          toolName: event.toolName,
          error: event.error,
        };
      case 'token':
        return { ...base, type: event.type, content: event.content };
      case 'run.waiting':
        return { ...base, type: event.type, reason: event.reason };
      case 'run.completed':
        return { ...base, type: event.type, response: event.response, usage: event.usage };
      case 'run.failed':
        return { ...base, type: event.type, error: event.error };
      case 'run.cancelled':
        return { ...base, type: event.type, ...(event.reason ? { reason: event.reason } : {}) };
    }
  }
}

function redactSensitive(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return String(value);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(entry),
    ]),
  );
}
