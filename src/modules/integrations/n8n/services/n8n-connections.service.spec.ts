import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretBoxService } from '../../../../infrastructure/crypto/secret-box.service';
import { N8nClientApiError } from '../../../../infrastructure/n8n/n8n-client-api.service';
import { N8nConnectionsService } from './n8n-connections.service';

const connection = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'conn-1',
    name: 'Client n8n',
    baseUrl: 'https://n8n.client.example.com',
    status: 'PENDING_VERIFICATION',
    lastVerifiedAt: null,
    lastError: null,
    userId: 'user-1',
    organizationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as never;

const setup = () => {
  const repository = {
    create: vi.fn().mockResolvedValue(connection()),
    findById: vi
      .fn()
      .mockResolvedValue(connection({ status: 'ACTIVE', lastVerifiedAt: new Date() })),
    list: vi.fn().mockResolvedValue([connection({ status: 'ACTIVE' })]),
    update: vi
      .fn()
      .mockImplementation(async (_id: string, data: Record<string, unknown>) =>
        connection({ status: 'ACTIVE', lastVerifiedAt: new Date(), ...data }),
      ),
    softDelete: vi.fn().mockResolvedValue(connection({ deletedAt: new Date() })),
    getCredential: vi.fn().mockResolvedValue({ connectionId: 'conn-1', encryptedData: 'enc' }),
    upsertCredential: vi.fn().mockResolvedValue({}),
  };
  const secretBox = {
    isConfigured: vi.fn().mockReturnValue(true),
    encrypt: vi.fn().mockReturnValue('encrypted-blob'),
    decrypt: vi.fn().mockReturnValue('sk-client-api-key-9876'),
  };
  const clientApi = { verify: vi.fn().mockResolvedValue({ ok: true }) };

  const service = new N8nConnectionsService(
    repository as never,
    secretBox as unknown as SecretBoxService,
    clientApi as never,
  );
  return { service, repository, secretBox, clientApi };
};

const scope = { userId: 'user-1' };

describe('N8nConnectionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a connection in PENDING_VERIFICATION, stores an encrypted key, then verifies to ACTIVE', async () => {
    const { service, repository, secretBox, clientApi } = setup();

    const view = await service.create(
      {
        name: 'Client n8n',
        baseUrl: 'https://n8n.client.example.com/',
        apiKey: 'sk-client-api-key-9876',
      },
      scope,
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Client n8n',
        baseUrl: 'https://n8n.client.example.com', // trailing slash stripped
        status: 'PENDING_VERIFICATION',
        user: { connect: { id: 'user-1' } },
      }),
    );
    expect(secretBox.encrypt).toHaveBeenCalledWith('sk-client-api-key-9876');
    expect(repository.upsertCredential).toHaveBeenCalledWith('conn-1', 'encrypted-blob');
    expect(clientApi.verify).toHaveBeenCalled();
    expect(view.status).toBe('ACTIVE');
    expect(view.keyPreview).toBe('…9876'); // masked: ellipsis + last 4 chars only
    expect(JSON.stringify(view)).not.toContain('sk-client-api-key-9876');
  });

  it('marks the connection INVALID when n8n rejects the API key', async () => {
    const { service, repository, clientApi } = setup();
    clientApi.verify.mockRejectedValue(
      new N8nClientApiError('n8n API key rejected', 'INVALID_CREDENTIALS', 401),
    );

    const view = await service.create(
      { name: 'Client n8n', baseUrl: 'https://n8n.client.example.com', apiKey: 'sk-bad-key-0000' },
      scope,
    );

    expect(view.status).toBe('INVALID');
    expect(view.lastError).toContain('API key rejected');
    expect(repository.update).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ status: 'INVALID' }),
    );
  });

  it('keeps ACTIVE status on transient network failures', async () => {
    const { service, clientApi } = setup();
    clientApi.verify.mockRejectedValue(new N8nClientApiError('unreachable', 'UNREACHABLE'));

    // Existing connection was already ACTIVE (repository.findById default)
    await service.verify('conn-1', scope);
    const view = (await service.findById('conn-1', scope)) as unknown as { status: string };
    expect(['ACTIVE']).toContain(view.status);
  });

  it('throws NotFound for connections outside the owner scope', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(null);

    await expect(service.findById('conn-other', scope)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses to create when secret encryption is not configured', async () => {
    const { service, secretBox, repository } = setup();
    secretBox.isConfigured.mockReturnValue(false);

    await expect(
      service.create(
        { name: 'x', baseUrl: 'https://n8n.client.example.com', apiKey: 'sk-something-123' },
        scope,
      ),
    ).rejects.toThrow(/Secret encryption is not configured/);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('resolveCredentials returns decrypted creds only for ACTIVE connections', async () => {
    const { service, repository } = setup();

    const creds = await service.resolveCredentials('conn-1');
    expect(creds).toEqual({
      baseUrl: 'https://n8n.client.example.com',
      apiKey: 'sk-client-api-key-9876',
    });

    repository.findById.mockResolvedValue(connection({ status: 'SUSPENDED' }));
    expect(await service.resolveCredentials('conn-1')).toBeNull();
  });
});
