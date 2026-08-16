import { describe, expect, it, vi } from 'vitest';
import { N8nIntegrationRegistryService } from './n8n-integration-registry.service';

describe('N8nIntegrationRegistryService', () => {
  it('resolves configured workflow names without exposing credentials', () => {
    const integrations = { isConnected: vi.fn() };
    const service = new N8nIntegrationRegistryService(
      integrations as never,
      {
        get: vi
          .fn()
          .mockReturnValue('{"send_email":{"workflow":"email-v2","requiredIntegration":"gmail"}}'),
      } as never,
    );

    expect(service.resolve('send_email')).toEqual({
      workflow: 'email-v2',
      requiredIntegration: 'gmail',
    });
  });

  it('requires an organization and connected integration for scoped capabilities', async () => {
    const integrations = { isConnected: vi.fn().mockResolvedValue(true) };
    const service = new N8nIntegrationRegistryService(
      integrations as never,
      { get: vi.fn().mockReturnValue(undefined) } as never,
    );

    await expect(service.isAvailable(undefined, 'gmail')).resolves.toBe(false);
    await expect(service.isAvailable('org-1', 'gmail')).resolves.toBe(true);
    expect(integrations.isConnected).toHaveBeenCalledWith('org-1', 'gmail');
  });

  it('treats malformed workflow configuration as empty', () => {
    const service = new N8nIntegrationRegistryService(
      { isConnected: vi.fn() } as never,
      { get: vi.fn().mockReturnValue('{invalid') } as never,
    );

    expect(service.resolve('send_email')).toEqual({ workflow: 'send_email' });
  });
});
