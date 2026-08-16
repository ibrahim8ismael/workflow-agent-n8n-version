import type {
  ApprovalDecision,
  RuntimeEvent,
  RuntimeResult,
  RuntimeScope,
  StartRunRequest,
} from '../types/runtime-contract.types';

export interface JaafarRuntimeServiceContract {
  start(request: StartRunRequest): Promise<RuntimeResult>;
  resume(runId: string, scope?: RuntimeScope): Promise<RuntimeResult>;
  approve(runId: string, decision: ApprovalDecision, scope?: RuntimeScope): Promise<RuntimeResult>;
  reject(runId: string, reason?: string, scope?: RuntimeScope): Promise<RuntimeResult>;
  cancel(runId: string, scope?: RuntimeScope): Promise<RuntimeResult>;
  stream(request: StartRunRequest): AsyncGenerator<RuntimeEvent>;
}
