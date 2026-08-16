import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JsonValue } from '../../modules/runtime/interfaces/tool.interface';
import { N8nIntegrationRegistryService } from './n8n-integration-registry.service';

export interface N8nWorkflowRequest {
  workflow: string;
  input: Record<string, unknown>;
  userId?: string;
  organizationId?: string;
  timeoutMs: number;
  idempotencyKey?: string;
}

export class N8nWorkflowError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = N8nWorkflowError.name;
  }
}

@Injectable()
export class N8nWorkflowExecutorService {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly registry?: N8nIntegrationRegistryService,
  ) {}

  async execute(request: N8nWorkflowRequest): Promise<JsonValue> {
    const webhookBase = this.config.get<string>('N8N_WEBHOOK_URL');
    if (!webhookBase) throw new N8nWorkflowError('N8N_WEBHOOK_URL is not configured', false);
    const descriptor = this.registry?.resolve(request.workflow) ?? { workflow: request.workflow };
    await this.registry?.assertAvailable(request.organizationId, descriptor.requiredIntegration);

    const response = await fetch(`${webhookBase.replace(/\/+$/, '')}/${descriptor.workflow}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        ...request.input,
        userId: request.userId,
        organizationId: request.organizationId,
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok) {
      throw new N8nWorkflowError(
        `n8n workflow returned HTTP ${response.status}`,
        response.status >= 500,
      );
    }
    return (await ((response.headers.get('content-type') ?? '').includes('application/json')
      ? response.json()
      : response.text())) as JsonValue;
  }
}
