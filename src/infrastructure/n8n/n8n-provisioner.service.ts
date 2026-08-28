import { Injectable, Logger } from '@nestjs/common';
import {
  type AutomationBlueprint,
  automationWebhookSlug,
} from '../../modules/automations/schemas/automation-blueprint.schema';
import { N8nClientApiService, type N8nClientConnection } from './n8n-client-api.service';

export interface ProvisionResult {
  externalWorkflowId: string;
  webhookPath: string;
}

interface ProvisionRequest {
  automationId: string;
  blueprint: AutomationBlueprint;
  connection: N8nClientConnection;
}

/**
 * Provisions Jaafar-designed automations into a CLIENT's n8n instance.
 * Blueprint → workflow JSON: webhook node (path = automation slug) →
 * one Code node per blueprint step (conservative skeleton with TODO markers)
 * → respondToWebhook node. Created, then activated.
 */
@Injectable()
export class N8nProvisionerService {
  private readonly logger = new Logger(N8nProvisionerService.name);

  constructor(private readonly clientApi: N8nClientApiService) {}

  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    const { automationId, blueprint, connection } = request;
    const webhookPath = automationWebhookSlug(automationId, blueprint.name);
    const workflow = this.toWorkflowJson(automationId, blueprint, webhookPath);

    const created = await this.clientApi.createWorkflow(connection, workflow);
    await this.clientApi.activateWorkflow(connection, created.id);

    // Read back to capture the effective webhook path (drift/collision safety).
    const detail = await this.clientApi.getWorkflow(connection, created.id);
    const hooks = N8nClientApiService.extractWebhookPaths(detail);
    const effectivePath = hooks[0]?.path ?? webhookPath;

    this.logger.log({
      event: 'n8n.automation_provisioned',
      automationId,
      workflowId: created.id,
      webhookPath: effectivePath,
    });
    return { externalWorkflowId: created.id, webhookPath: effectivePath };
  }

  // ── internals ──────────────────────────────────────────────

  private toWorkflowJson(
    automationId: string,
    blueprint: AutomationBlueprint,
    webhookPath: string,
  ): Record<string, unknown> {
    const webhookName = `Webhook: ${webhookPath}`;
    const stepNodes = blueprint.steps.map((step, index) => {
      const id = `step-${index + 1}-${automationId.slice(0, 8)}`;
      const name = `Step ${index + 1}: ${step.name}`;
      const todo = [
        `// Automation: ${blueprint.name} (${automationId})`,
        `// Goal: ${blueprint.goal}`,
        `// Step ${index + 1}: ${step.action}`,
        ...(step.integration ? [`// Integration: ${step.integration}`] : []),
        `// TODO: replace this skeleton with real integration logic`,
        `// Blueprint config: ${JSON.stringify(step.config ?? {})}`,
      ].join('\n');
      return {
        parameters: {
          jsCode: `${todo}\nconst payload = $json.body || $json;\nconst input = payload.input || {};\n\nreturn {\n  json: {\n    success: true,\n    step: ${JSON.stringify(step.name)},\n    data: { inputReceived: input },\n    timestamp: new Date().toISOString(),\n  },\n};`,
        },
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [250 + index * 250, 0],
        id,
        name,
      };
    });

    const nodes = [
      {
        parameters: {
          httpMethod: 'POST',
          path: webhookPath,
          responseMode: 'lastNode',
          options: {},
        },
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        id: `webhook-${automationId.slice(0, 8)}`,
        name: webhookName,
      },
      ...stepNodes,
      {
        parameters: {
          respondWith: 'json',
          responseBody: '={{ JSON.stringify($json) }}',
        },
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [250 + blueprint.steps.length * 250, 0],
        id: `respond-${automationId.slice(0, 8)}`,
        name: 'Respond to Agent Engine',
      },
    ];

    const chain = [webhookName, ...stepNodes.map((node) => node.name)];
    const connections: Record<string, unknown> = {};
    for (let i = 0; i < chain.length - 1; i++) {
      connections[chain[i]!] = {
        main: [[{ node: chain[i + 1]!, type: 'main', index: 0 }]],
      };
    }

    return {
      name: `Woops - ${blueprint.name} (${automationId.slice(0, 8)})`,
      nodes,
      connections,
      settings: { executionOrder: 'v1' },
    };
  }
}
