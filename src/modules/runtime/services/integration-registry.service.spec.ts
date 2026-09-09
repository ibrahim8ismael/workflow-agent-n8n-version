import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nClientApiError } from '../../../infrastructure/n8n/n8n-client-api.service';
import { IntegrationRegistryService } from './integration-registry.service';

describe('IntegrationRegistryService', () => {
  const connections = { resolveActiveForScope: vi.fn() };
  const clientApi = { listCredentials: vi.fn() };
  const nodeInventory = { inventory: vi.fn() };
  const integrations = { findByOrganization: vi.fn() };

  const service = () =>
    new IntegrationRegistryService(
      connections as never,
      clientApi as never,
      nodeInventory as never,
      integrations as never,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    connections.resolveActiveForScope.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://n8n.example.com',
      apiKey: 'sk-secret-that-must-never-leak',
    });
    clientApi.listCredentials.mockResolvedValue([
      { id: 'cred-1', name: 'Slack prod', type: 'slackOAuth2Api' },
      { id: 'cred-2', name: 'WA', type: 'whatsAppCloudApi' },
    ]);
    nodeInventory.inventory.mockResolvedValue({
      nodeTypes: [{ type: 'n8n-nodes-base.slack', inUse: true }],
      dataTables: [],
      dataTablesSupported: false,
    });
    integrations.findByOrganization.mockResolvedValue([
      { provider: 'Zoho', name: 'Zoho CRM', status: 'CONNECTED' },
      { provider: 'Slack', name: 'Slack (platform)', status: 'DISCONNECTED' },
    ]);
  });

  it('merges n8n credentials with platform integrations, n8n winning conflicts', async () => {
    const capabilities = await service().capabilitiesForScope({
      userId: 'user-1',
      organizationId: 'org-1',
    });

    const slack = capabilities.find((c) => c.provider === 'slack');
    expect(slack).toMatchObject({
      source: 'n8n',
      connectionStatus: 'CONNECTED',
      credentialsAvailable: true,
      credentialType: 'slackOAuth2Api',
      nodeTypes: ['n8n-nodes-base.slack'],
    });
    expect(capabilities.find((c) => c.provider === 'whatsapp')).toMatchObject({
      displayName: 'Whatsapp',
      connectionStatus: 'CONNECTED',
    });
    expect(capabilities.find((c) => c.provider === 'zoho')).toMatchObject({
      source: 'platform',
      connectionStatus: 'CONNECTED',
    });
  });

  it('never exposes secrets — only type names and metadata reach the caller', async () => {
    const capabilities = await service().capabilitiesForScope({ organizationId: 'org-1' });

    const serialized = JSON.stringify(capabilities);
    expect(serialized).not.toContain('sk-secret-that-must-never-leak');
    expect(serialized).not.toContain('cred-1');
    expect(serialized).toContain('slackOAuth2Api');
  });

  it('degrades to platform-only when the n8n credential route is unavailable', async () => {
    clientApi.listCredentials.mockRejectedValue(
      new N8nClientApiError('forbidden', 'INVALID_CREDENTIALS', 403),
    );

    const capabilities = await service().capabilitiesForScope({ organizationId: 'org-1' });

    expect(capabilities.find((c) => c.provider === 'zoho')).toMatchObject({
      connectionStatus: 'CONNECTED',
    });
    expect(capabilities.some((c) => c.source === 'n8n')).toBe(false);
  });

  it('returns no n8n capabilities without an active connection', async () => {
    connections.resolveActiveForScope.mockResolvedValue(null);

    const capabilities = await service().capabilitiesForScope({ organizationId: 'org-1' });

    expect(capabilities.every((c) => c.source === 'platform')).toBe(true);
  });

  it('caches per scope and refreshes on invalidate', async () => {
    const svc = service();

    await svc.capabilitiesForScope({ organizationId: 'org-1' });
    await svc.capabilitiesForScope({ organizationId: 'org-1' });
    expect(clientApi.listCredentials).toHaveBeenCalledTimes(1);

    svc.invalidate({ organizationId: 'org-1' });
    await svc.capabilitiesForScope({ organizationId: 'org-1' });
    expect(clientApi.listCredentials).toHaveBeenCalledTimes(2);
  });

  it('normalizes unknown credential types with the suffix heuristic', async () => {
    const svc = service();

    expect(svc.providerForCredentialType('slackOAuth2Api')).toBe('slack');
    expect(svc.providerForCredentialType('someNewToolApi')).toBe('somenewtool');
    expect(svc.providerForCredentialType('customOAuth2')).toBe('custom');
  });
});
