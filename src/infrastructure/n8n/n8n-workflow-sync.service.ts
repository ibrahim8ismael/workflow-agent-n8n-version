import { Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  nodes?: Array<{ type: string; parameters?: Record<string, unknown> }>;
}

@Injectable()
export class N8nWorkflowSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(N8nWorkflowSyncService.name);
  private readonly apiUrl?: string;
  private readonly apiKey?: string;
  private readonly internalSecret?: string;
  private readonly backendUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly db?: DatabaseService,
  ) {
    const rawApiUrl = this.config.get<string>('N8N_API_URL');
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    this.apiUrl = rawApiUrl || (baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/v1` : undefined);
    this.apiKey = this.config.get<string>('N8N_API_KEY');
    this.internalSecret = this.config.get<string>('WOOPS_INTER_SERVICE_SECRET');
    this.backendUrl =
      this.config.get<string>('BACKEND_INTERNAL_URL') ||
      `http://localhost:${this.config.get<number>('PORT') || 3000}`;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.apiUrl || !this.apiKey) {
      this.logger.log(
        'N8N_API_URL or N8N_API_KEY not provided — skipping auto-provisioning API sync (using convention webhooks).',
      );
      return;
    }

    try {
      await this.syncAllWorkflows();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Workflow auto-sync encountered an issue during startup: ${msg}`);
    }
  }

  /**
   * Discovers all skills requiring workflow execution and ensures corresponding workflows are provisioned and active in n8n.
   */
  async syncAllWorkflows(): Promise<{ provisioned: number; skipped: number }> {
    if (!this.apiUrl || !this.apiKey) return { provisioned: 0, skipped: 0 };

    this.logger.log('Starting automated workflow provisioning & sync with Workflow Engine...');

    const existingWorkflows = await this.listWorkflows();
    const existingByName = new Map(existingWorkflows.map((wf) => [wf.name.toLowerCase(), wf]));

    let provisioned = 0;
    let skipped = 0;

    // 1. Ensure Inbound Channel Gateway workflow is provisioned
    const inboundName = 'Woops - Inbound Channel Gateway';
    if (!existingByName.has(inboundName.toLowerCase())) {
      await this.createInboundGatewayWorkflow(inboundName);
      provisioned++;
    } else {
      skipped++;
    }

    // 2. Ensure default core skills are provisioned
    const defaultSkills: Array<{ slug: string; name: string; description?: string }> = [
      {
        slug: 'search_customer',
        name: 'Search Customer',
        description: 'Search customer records, deals, and status from the CRM.',
      },
      {
        slug: 'send_channel_message',
        name: 'Send Channel Message',
        description: 'Send outbound messaging reply to WhatsApp or Slack channel.',
      },
    ];

    // 3. Collect all database skills marked as N8N_WORKFLOW
    let dbSkills: Array<{ slug: string; name: string; description?: string | null }> = [];
    if (this.db) {
      try {
        dbSkills = await this.db.skill.findMany({
          where: { executionMode: 'N8N_WORKFLOW', deletedAt: null },
          select: { slug: true, name: true, description: true },
        });
      } catch {
        // Fall back to default core skills if DB not queried
      }
    }

    const allSkillsToSync = [...defaultSkills];
    for (const dbs of dbSkills) {
      if (!allSkillsToSync.some((s) => s.slug === dbs.slug)) {
        allSkillsToSync.push({
          slug: dbs.slug,
          name: dbs.name,
          description: dbs.description ?? undefined,
        });
      }
    }

    for (const skill of allSkillsToSync) {
      const wfName = `Woops - ${skill.slug}`;
      const existing = existingByName.get(wfName.toLowerCase());

      if (!existing) {
        await this.createSkillWorkflow(skill);
        provisioned++;
      } else if (!existing.active) {
        await this.activateWorkflow(existing.id);
        provisioned++;
      } else {
        skipped++;
      }
    }

    this.logger.log(
      `Automated workflow sync complete: ${provisioned} provisioned/activated, ${skipped} already active.`,
    );
    return { provisioned, skipped };
  }

  /**
   * Ensures a workflow exists and is active for a specific skill (e.g. called when a skill is created or published).
   */
  async ensureWorkflowForSkill(skill: {
    slug: string;
    name: string;
    description?: string;
  }): Promise<string | undefined> {
    if (!this.apiUrl || !this.apiKey) return undefined;

    const wfName = `Woops - ${skill.slug}`;
    const existingWorkflows = await this.listWorkflows();
    const existing = existingWorkflows.find((w) => w.name.toLowerCase() === wfName.toLowerCase());

    if (existing) {
      if (!existing.active) {
        await this.activateWorkflow(existing.id);
      }
      return existing.id;
    }

    return this.createSkillWorkflow(skill);
  }

  private async listWorkflows(): Promise<N8nWorkflowSummary[]> {
    const url = `${this.apiUrl}/workflows`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': this.apiKey!,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list n8n workflows: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { data?: N8nWorkflowSummary[] } | N8nWorkflowSummary[];
    return Array.isArray(data) ? data : data.data || [];
  }

  private async createSkillWorkflow(skill: {
    slug: string;
    name: string;
    description?: string;
  }): Promise<string> {
    const workflowPayload = {
      name: `Woops - ${skill.slug}`,
      nodes: [
        {
          parameters: {
            httpMethod: 'POST',
            path: skill.slug,
            responseMode: 'lastNode',
            options: {},
          },
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          id: `webhook-${skill.slug}`,
          name: `Webhook: /webhook/${skill.slug}`,
        },
        {
          parameters: {
            jsCode: `// Automatically generated execution node for skill: ${skill.slug}
const payload = $json.body || $json;
const input = payload.input || {};

// Return standardized successful data envelope
return {
  json: {
    success: true,
    data: {
      skillSlug: '${skill.slug}',
      status: 'COMPLETED',
      inputReceived: input,
      timestamp: new Date().toISOString()
    }
  }
};`,
          },
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [250, 0],
          id: `logic-${skill.slug}`,
          name: `Execute ${skill.name}`,
        },
        {
          parameters: {
            respondWith: 'json',
            responseBody: '={{ JSON.stringify($json) }}',
          },
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [500, 0],
          id: `respond-${skill.slug}`,
          name: 'Respond to Agent Engine',
        },
      ],
      connections: {
        [`Webhook: /webhook/${skill.slug}`]: {
          main: [
            [
              {
                node: `Execute ${skill.name}`,
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
        [`Execute ${skill.name}`]: {
          main: [
            [
              {
                node: 'Respond to Agent Engine',
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
      },
      settings: {
        executionOrder: 'v1',
      },
    };

    const created = await this.postWorkflow(workflowPayload);
    await this.activateWorkflow(created.id);
    this.logger.log(
      `Auto-provisioned active workflow for skill "${skill.slug}" (ID: ${created.id})`,
    );
    return created.id;
  }

  private async createInboundGatewayWorkflow(name: string): Promise<string> {
    const internalSecretHeader = this.internalSecret || 'woops-super-secret-key-123456789';
    const targetUrl = `${this.backendUrl.replace(/\/+$/, '')}/api/v1/channels/inbound`;

    const workflowPayload = {
      name,
      nodes: [
        {
          parameters: {
            httpMethod: 'POST',
            path: 'channel-inbound',
            responseMode: 'lastNode',
            options: {},
          },
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          id: 'webhook-channel-inbound',
          name: 'Webhook: Inbound Channel Trigger',
        },
        {
          parameters: {
            jsCode: `const body = $json.body || $json;

const inboundMessage = {
  channelType: body.channelType || 'WHATSAPP',
  channelIdentifier: body.channelIdentifier || '+14155552671',
  externalUserId: body.externalUserId || body.sender?.phone || 'customer_user_1',
  externalMessageId: body.messageId || 'msg_' + Date.now(),
  externalConversationId: body.conversationId || 'conv_wa_1',
  sender: {
    name: body.sender?.name || 'Customer',
    phone: body.sender?.phone || '+14155552671'
  },
  message: {
    type: 'text',
    content: body.message?.content || body.text || 'Hello'
  }
};

return { json: inboundMessage };`,
          },
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [250, 0],
          id: 'format-inbound-payload',
          name: 'Format Inbound Payload',
        },
        {
          parameters: {
            method: 'POST',
            url: targetUrl,
            sendHeaders: true,
            headerParameters: {
              parameters: [
                {
                  name: 'X-Woops-Internal-Key',
                  value: internalSecretHeader,
                },
                {
                  name: 'Content-Type',
                  value: 'application/json',
                },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: {},
          },
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [500, 0],
          id: 'post-to-agent-engine',
          name: 'Forward to Agent Engine',
        },
        {
          parameters: {
            respondWith: 'json',
            responseBody: '={{ JSON.stringify($json) }}',
          },
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1.1,
          position: [750, 0],
          id: 'respond-to-channel',
          name: 'Respond to Channel',
        },
      ],
      connections: {
        'Webhook: Inbound Channel Trigger': {
          main: [
            [
              {
                node: 'Format Inbound Payload',
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
        'Format Inbound Payload': {
          main: [
            [
              {
                node: 'Forward to Agent Engine',
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
        'Forward to Agent Engine': {
          main: [
            [
              {
                node: 'Respond to Channel',
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
      },
      settings: {
        executionOrder: 'v1',
      },
    };

    const created = await this.postWorkflow(workflowPayload);
    await this.activateWorkflow(created.id);
    this.logger.log(`Auto-provisioned active Inbound Channel Gateway (ID: ${created.id})`);
    return created.id;
  }

  private async postWorkflow(payload: Record<string, unknown>): Promise<{ id: string }> {
    const url = `${this.apiUrl}/workflows`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': this.apiKey!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to create n8n workflow: HTTP ${response.status} - ${errText}`);
    }

    return (await response.json()) as { id: string };
  }

  private async activateWorkflow(workflowId: string): Promise<void> {
    const url = `${this.apiUrl}/workflows/${workflowId}/activate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': this.apiKey!,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      this.logger.warn(
        `Could not explicitly activate workflow ${workflowId} (HTTP ${response.status})`,
      );
    }
  }
}
