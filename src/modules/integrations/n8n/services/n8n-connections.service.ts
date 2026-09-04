import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { N8nConnection } from '@prisma/client';
import { SecretBoxService } from '../../../../infrastructure/crypto/secret-box.service';
import {
  N8nClientApiError,
  N8nClientApiService,
} from '../../../../infrastructure/n8n/n8n-client-api.service';
import { N8N_CONNECTION_STATUS } from '../constants/n8n-connection.constants';
import type { CreateN8nConnectionDto, UpdateN8nConnectionDto } from '../dto/n8n-connection.dto';
import type { OwnerScope } from '../repositories/n8n-connections.repository';
import { N8nConnectionsRepository } from '../repositories/n8n-connections.repository';

/** Connection as exposed by the API — never includes the API key. */
export interface N8nConnectionView {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  keyPreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class N8nConnectionsService {
  private readonly logger = new Logger(N8nConnectionsService.name);

  constructor(
    private readonly repository: N8nConnectionsRepository,
    private readonly secretBox: SecretBoxService,
    private readonly clientApi: N8nClientApiService,
  ) {}

  async create(dto: CreateN8nConnectionDto, scope: OwnerScope): Promise<N8nConnectionView> {
    if (!this.secretBox.isConfigured()) {
      throw new Error('Secret encryption is not configured (missing CREDENTIAL_ENCRYPTION_KEY)');
    }

    const connection = await this.repository.create({
      name: dto.name,
      baseUrl: dto.baseUrl.replace(/\/+$/, ''),
      status: N8N_CONNECTION_STATUS.PENDING_VERIFICATION,
      ...(scope.userId ? { user: { connect: { id: scope.userId } } } : {}),
      ...(scope.organizationId ? { organization: { connect: { id: scope.organizationId } } } : {}),
    });

    await this.repository.upsertCredential(connection.id, this.secretBox.encrypt(dto.apiKey));

    return this.verifyAndRefresh(connection);
  }

  async list(scope: OwnerScope): Promise<N8nConnectionView[]> {
    const connections = await this.repository.list(scope);
    return Promise.all(connections.map((connection) => this.toView(connection)));
  }

  async findById(id: string, scope: OwnerScope): Promise<N8nConnectionView> {
    return this.toView(await this.getOwned(id, scope));
  }

  async update(
    id: string,
    dto: UpdateN8nConnectionDto,
    scope: OwnerScope,
  ): Promise<N8nConnectionView> {
    const connection = await this.getOwned(id, scope);

    let updated = connection;
    if (dto.name || dto.baseUrl || dto.apiKey) {
      updated = await this.repository.update(id, {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.baseUrl ? { baseUrl: dto.baseUrl.replace(/\/+$/, '') } : {}),
        status: N8N_CONNECTION_STATUS.PENDING_VERIFICATION,
        lastError: null,
      });
      // Key rotation re-verifies with the new credential below.
      if (!dto.baseUrl) updated = connection; // keep in-memory copy for verify
    }
    if (dto.apiKey) {
      await this.repository.upsertCredential(id, this.secretBox.encrypt(dto.apiKey));
    }
    if (dto.status) {
      updated = await this.repository.update(id, { status: dto.status });
      return this.toView(updated);
    }

    return this.verifyAndRefresh(updated);
  }

  /** Re-runs verification against the client's n8n and refreshes status. */
  async verify(id: string, scope: OwnerScope): Promise<N8nConnectionView> {
    return this.verifyAndRefresh(await this.getOwned(id, scope));
  }

  async softDelete(id: string, scope: OwnerScope): Promise<N8nConnectionView> {
    await this.getOwned(id, scope); // ownership check
    const deleted = await this.repository.softDelete(id);
    // Automations bound to this connection are suspended by the runtime's
    // connection-status pre-check; a dedicated cascade lands with the
    // Automations module (PLAN Step 7).
    return this.toView(deleted);
  }

  /** Resolves decrypted credentials for internal callers (executor/provisioner). */
  async resolveCredentials(id: string): Promise<{ baseUrl: string; apiKey: string } | null> {
    const connection = await this.repository.findById(id);
    if (!connection || connection.status !== N8N_CONNECTION_STATUS.ACTIVE) return null;
    const credential = await this.repository.getCredential(id);
    if (!credential) return null;
    try {
      return {
        baseUrl: connection.baseUrl,
        apiKey: this.secretBox.decrypt(credential.encryptedData),
      };
    } catch {
      this.logger.error({ event: 'n8n.credential_decrypt_failed', connectionId: id });
      return null;
    }
  }

  // ── internals ──────────────────────────────────────────────

  private async getOwned(id: string, scope: OwnerScope): Promise<N8nConnection> {
    const connection = await this.repository.findById(id, scope);
    if (!connection) throw new NotFoundException(`n8n connection "${id}" not found`);
    return connection;
  }

  private async verifyAndRefresh(connection: N8nConnection): Promise<N8nConnectionView> {
    const credential = await this.repository.getCredential(connection.id);
    if (!credential) throw new NotFoundException(`n8n connection credentials missing`);

    try {
      const apiKey = this.secretBox.decrypt(credential.encryptedData);
      await this.clientApi.verify({ baseUrl: connection.baseUrl, apiKey });
      const refreshed = await this.repository.update(connection.id, {
        status: N8N_CONNECTION_STATUS.ACTIVE,
        lastVerifiedAt: new Date(),
        lastError: null,
      });
      return this.toView(refreshed, apiKey);
    } catch (error) {
      const message =
        error instanceof N8nClientApiError ? error.message : 'Verification failed unexpectedly';
      const refreshed = await this.repository.update(connection.id, {
        status:
          error instanceof N8nClientApiError && error.code === 'INVALID_CREDENTIALS'
            ? N8N_CONNECTION_STATUS.INVALID
            : connection.status === N8N_CONNECTION_STATUS.ACTIVE
              ? connection.status // transient network failure keeps prior state
              : N8N_CONNECTION_STATUS.INVALID,
        lastError: message,
      });
      this.logger.warn({ event: 'n8n.connection_verify_failed', connectionId: connection.id });
      return this.toView(refreshed);
    }
  }

  private async toView(connection: N8nConnection, knownKey?: string): Promise<N8nConnectionView> {
    let keyPreview: string | null = null;
    const rawKey = knownKey ?? (await this.decryptIfPossible(connection.id));
    if (rawKey && rawKey.length > 4) {
      keyPreview = `…${rawKey.slice(-4)}`;
    }
    return {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.baseUrl,
      status: connection.status,
      lastVerifiedAt: connection.lastVerifiedAt,
      lastError: connection.lastError,
      keyPreview,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  private async decryptIfPossible(connectionId: string): Promise<string | null> {
    const credential = await this.repository.getCredential(connectionId);
    if (!credential) return null;
    try {
      return this.secretBox.decrypt(credential.encryptedData);
    } catch {
      return null;
    }
  }
}
