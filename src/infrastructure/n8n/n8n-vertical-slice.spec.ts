import { describe, expect, it, vi } from 'vitest';
import { ChannelsInboundService } from '../../modules/channels/services/channels-inbound.service';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

describe('MVP Vertical Slice: Inbound Channel ↔ Agent Engine ↔ n8n Workflow', () => {
  const secret = 'woops-test-secret-123456';

  const mockConfig = () => ({
    get: vi.fn((key: string) => {
      if (key === 'N8N_WEBHOOK_URL') return 'https://n8n.woops.internal/webhook';
      if (key === 'WOOPS_INTER_SERVICE_SECRET') return secret;
      if (key === 'N8N_TIMEOUT_MS') return 2000;
      if (key === 'N8N_MAX_RETRIES') return 1;
      return undefined;
    }),
  });

  it('executes full round-trip: Inbound message -> AI Employee -> HMAC Outbound n8n Skill -> Final Response', async () => {
    // 1. Setup mock n8n webhook receiver that verifies HMAC signature
    let receivedN8nHeaders: Headers | Record<string, string> | undefined;
    let receivedN8nBody: unknown;

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/webhook/search_customer')) {
        receivedN8nHeaders = init?.headers as Record<string, string>;
        receivedN8nBody = init?.body ? JSON.parse(init.body as string) : {};

        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              customerId: 'cust_98231',
              name: 'Sarah Connor',
              plan: 'BUSINESS',
              status: 'ACTIVE',
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    vi.stubGlobal('fetch', fetchMock);

    // 2. Initialize Executor & Mock Dependencies
    const n8nExecutor = new N8nWorkflowExecutorService(mockConfig() as never);

    const mockChannelsRepo = {
      findByType: vi
        .fn()
        .mockResolvedValue([{ id: 'chan_whatsapp', agentId: 'agent_jaafar', type: 'WHATSAPP' }]),
    };

    const mockConversationsService = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'conv_wa_101' }),
      addMessage: vi.fn().mockResolvedValue({ id: 'msg_1' }),
    };

    const mockAgentsService = {
      findById: vi.fn().mockResolvedValue({
        id: 'agent_jaafar',
        name: 'Jaafar Support Specialist',
        organizationId: 'org_demo',
      }),
    };

    // Simulate Jaafar executing the search_customer skill via n8nExecutor
    const mockJaafarRuntime = {
      start: vi.fn().mockImplementation(async (req) => {
        // Jaafar decides to call search_customer skill
        const skillResult = await n8nExecutor.execute({
          workflow: 'search_customer',
          input: { query: 'Sarah' },
          agentId: req.agentId,
          conversationId: req.conversationId,
          organizationId: req.organizationId,
          idempotencyKey: `run_test_1:search_customer`,
        });

        const customer = skillResult as Record<string, unknown>;
        return {
          runId: 'run_test_1',
          status: 'COMPLETED',
          response: `Hi! I found your account: ${customer.name} is on the ${customer.plan} plan (Status: ${customer.status}).`,
        };
      }),
    };

    const inboundService = new ChannelsInboundService(
      mockChannelsRepo as never,
      mockConversationsService as never,
      mockAgentsService as never,
      mockJaafarRuntime as never,
    );

    // 3. Ingest Inbound Channel Message (e.g. from WhatsApp)
    const result = await inboundService.processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_sarah',
      message: {
        type: 'text',
        content: 'Hi Jaafar, can you check my subscription status for Sarah?',
      },
    });

    // 4. Verify End-to-End Success & Behavior
    expect(result.success).toBe(true);
    expect(result.conversationId).toBe('conv_wa_101');
    expect(result.runId).toBe('run_test_1');
    expect(result.response).toBe(
      'Hi! I found your account: Sarah Connor is on the BUSINESS plan (Status: ACTIVE).',
    );

    // Verify n8n Webhook received signed payload with idempotency
    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.woops.internal/webhook/search_customer',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(receivedN8nHeaders).toHaveProperty('X-Woops-Signature');
    expect(receivedN8nHeaders).toHaveProperty('Idempotency-Key', 'run_test_1:search_customer');
    expect(receivedN8nBody).toEqual(
      expect.objectContaining({
        skillSlug: 'search_customer',
        input: { query: 'Sarah' },
        organizationId: 'org_demo',
      }),
    );

    vi.unstubAllGlobals();
  });
});
