import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JsonValue } from '../../modules/runtime/interfaces/tool.interface';
import { computeHmacSignature } from '../auth/inter-service-crypto';
import { N8nIntegrationRegistryService } from './n8n-integration-registry.service';

export interface N8nWorkflowRequest {
  workflow: string;
  input: Record<string, unknown>;
  runId?: string;
  planStepId?: string;
  agentId?: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  timeoutMs?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  /**
   * Per-automation binding into a CLIENT's n8n instance (PLAN Step 10).
   * When present, execution targets {baseUrl}/webhook/{webhookPath} with
   * the binding's HMAC secret. When absent, the deprecated platform-global
   * env path is used (dual-read until Step 11 removes it).
   */
  binding?: N8nWorkflowBinding;
}

export interface N8nWorkflowBinding {
  baseUrl: string;
  webhookPath: string;
  /** Optional per-binding HMAC shared secret (same signature scheme). */
  secret?: string;
}

export class N8nWorkflowError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = N8nWorkflowError.name;
  }
}

@Injectable()
export class N8nWorkflowExecutorService {
  private readonly logger = new Logger(N8nWorkflowExecutorService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly registry?: N8nIntegrationRegistryService,
  ) {}

  async execute(request: N8nWorkflowRequest): Promise<JsonValue> {
    let webhookBase: string | undefined;
    let targetPath: string;
    let descriptor: { workflow: string; requiredIntegration?: string };

    if (request.binding) {
      webhookBase = `${request.binding.baseUrl.replace(/\/+$/, '')}/webhook`;
      targetPath = `/${request.binding.webhookPath.replace(/^\/+/, '')}`;
      descriptor = { workflow: request.binding.webhookPath };
    } else {
      // Deprecated platform-global path (dual-read). Removed at Step 11.
      this.logger.warn({
        event: 'n8n.legacy_env_binding',
        workflow: request.workflow,
        hint: 'Resolve automations into per-run bindings instead of platform n8n env globals',
      });
      webhookBase = this.config.get<string>('N8N_WEBHOOK_URL');
      if (!webhookBase) {
        throw new N8nWorkflowError('N8N_WEBHOOK_URL is not configured', false);
      }
      const resolved = this.registry?.resolve(request.workflow) ?? { workflow: request.workflow };
      descriptor = resolved;
      await this.registry?.assertAvailable(request.organizationId, descriptor.requiredIntegration);
      targetPath = `/${descriptor.workflow.replace(/^\/+/, '')}`;
    }

    const url = `${webhookBase.replace(/\/+$/, '')}${targetPath}`;
    const timeoutMs = request.timeoutMs ?? this.config.get<number>('N8N_TIMEOUT_MS') ?? 30_000;
    const maxRetries = this.config.get<number>('N8N_MAX_RETRIES') ?? 2;
    const secret = request.binding?.secret ?? this.config.get<string>('WOOPS_INTER_SERVICE_SECRET');

    const envelope = {
      runId: request.runId,
      planStepId: request.planStepId,
      skillSlug: request.workflow,
      organizationId: request.organizationId,
      userId: request.userId,
      agentId: request.agentId,
      conversationId: request.conversationId,
      input: request.input,
      metadata: {
        ...request.metadata,
        timestamp: Math.floor(Date.now() / 1000),
      },
    };

    const bodyString = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
    };

    if (secret) {
      const signature = computeHmacSignature({
        secret,
        timestamp,
        method: 'POST',
        path: targetPath,
        body: bodyString,
      });
      headers['X-Woops-Signature'] = `sha256=${signature}`;
      headers['X-Woops-Timestamp'] = String(timestamp);
      headers['X-Woops-Internal-Key'] = secret;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          this.logger.log({
            event: 'n8n.retry',
            workflow: descriptor.workflow,
            attempt,
            runId: request.runId,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyString,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const isRetryable = response.status >= 500 || response.status === 429;
          let errorMessage = `n8n workflow returned HTTP ${response.status}`;
          try {
            const errBody = await response.json();
            if (errBody && typeof errBody === 'object' && 'message' in errBody) {
              errorMessage = `${errorMessage}: ${String(errBody.message)}`;
            }
          } catch {
            // Ignore JSON parse error on non-json body
          }
          throw new N8nWorkflowError(errorMessage, isRetryable, response.status);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const jsonResult = (await response.json()) as Record<string, unknown>;
          // Unwrap standard n8n envelope { success: true, data: ... } if present
          if (
            jsonResult &&
            typeof jsonResult === 'object' &&
            'data' in jsonResult &&
            jsonResult.success === true
          ) {
            return jsonResult.data as JsonValue;
          }
          return jsonResult as unknown as JsonValue;
        }

        return (await response.text()) as JsonValue;
      } catch (error) {
        lastError = error;
        const isRetryable =
          error instanceof N8nWorkflowError
            ? error.retryable
            : /timeout|timed out|network|fetch|ECONNREFUSED|ECONNRESET/i.test(
                error instanceof Error ? error.message : String(error),
              );

        if (!isRetryable || attempt === maxRetries) {
          break;
        }
      }
    }

    if (lastError instanceof N8nWorkflowError) {
      throw lastError;
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new N8nWorkflowError(`n8n workflow execution failed: ${message}`, false);
  }
}
