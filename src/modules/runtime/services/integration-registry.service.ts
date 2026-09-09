import { Injectable, Logger } from '@nestjs/common';
import {
  N8nClientApiError,
  N8nClientApiService,
  type N8nClientConnection,
} from '../../../infrastructure/n8n/n8n-client-api.service';
import { N8nNodeInventoryService } from '../../../infrastructure/n8n/n8n-node-inventory.service';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { IntegrationsService } from '../../integrations/services/integrations.service';

export type IntegrationConnectionStatus = 'CONNECTED' | 'UNAVAILABLE' | 'DISCONNECTED';

/**
 * One integration Jaafar may plan against. Carries capability metadata
 * only — credential TYPE names, never ids, keys, or secrets. The LLM sees
 * this shape, never anything that could authenticate.
 */
export interface IntegrationCapability {
  /** Normalized provider key, e.g. `slack`, `whatsapp`, `zoho`. */
  provider: string;
  displayName: string;
  source: 'n8n' | 'platform';
  connectionStatus: IntegrationConnectionStatus;
  credentialsAvailable: boolean;
  /** n8n credential TYPE name (e.g. `slackOAuth2Api`) — safe by design. */
  credentialType?: string;
  /** n8n node types observed for this provider in the client instance. */
  nodeTypes?: string[];
  /**
   * Fallback native-node hint for prompts (e.g. `hubspot` →
   * `n8n-nodes-base.hubSpot`). A mapping hint only — the connected
   * instance inventory remains authoritative for existence.
   */
  suggestedNodeType?: string;
}

export interface IntegrationScope {
  userId?: string;
  organizationId?: string;
}

/**
 * Well-known n8n credential type → provider mappings. Anything unmapped
 * falls back to a suffix-stripping heuristic below.
 */
const CREDENTIAL_TYPE_ALIASES: Record<string, string> = {
  slackOAuth2Api: 'slack',
  slackApi: 'slack',
  gmailOAuth2: 'gmail',
  googleSheetsOAuth2Api: 'google_sheets',
  googleSheetsTriggerOAuth2Api: 'google_sheets',
  telegramApi: 'telegram',
  whatsAppCloudApi: 'whatsapp',
  whatsAppTriggerApi: 'whatsapp',
  zohoOAuth2Api: 'zoho',
  hubspotOAuth2Api: 'hubspot',
  notionApi: 'notion',
  airtableApi: 'airtable',
  discordWebhookApi: 'discord',
  openAiApi: 'openai',
  postgres: 'postgres',
  mySql: 'mysql',
  mongoDb: 'mongodb',
  redis: 'redis',
  smtp: 'smtp',
  imap: 'imap',
  ftp: 'ftp',
  sftp: 'sftp',
  salesforceOAuth2Api: 'salesforce',
  pipedriveApi: 'pipedrive',
  shopifyApi: 'shopify',
  hubSpotOAuth2Api: 'hubspot',
  zohoCrmOAuth2Api: 'zoho',
};

/**
 * Minimal provider → native node hints for prompts. Fallback mappings
 * only — they never prove the node exists in the connected instance.
 */
const SUGGESTED_NODE_TYPES: Record<string, string> = {
  slack: 'n8n-nodes-base.slack',
  gmail: 'n8n-nodes-base.gmail',
  google_sheets: 'n8n-nodes-base.googleSheets',
  telegram: 'n8n-nodes-base.telegram',
  whatsapp: 'n8n-nodes-base.whatsApp',
  hubspot: 'n8n-nodes-base.hubSpot',
  salesforce: 'n8n-nodes-base.salesforce',
  zoho: 'n8n-nodes-base.zohoCrm',
  pipedrive: 'n8n-nodes-base.pipedrive',
  shopify: 'n8n-nodes-base.shopify',
  notion: 'n8n-nodes-base.notion',
  airtable: 'n8n-nodes-base.airtable',
  discord: 'n8n-nodes-base.discord',
  openai: '@n8n/n8n-nodes-langchain.openAi',
};

function normalizeProvider(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nodeSuffixMatch(nodeType: string, provider: string): boolean {
  const dot = nodeType.lastIndexOf('.');
  const suffix = normalizeProvider(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
  return suffix === provider;
}

const REGISTRY_CACHE_TTL_MS = 60_000;

interface RegistryCacheEntry {
  expiresAt: number;
  value: IntegrationCapability[];
}

/**
 * Integration Capability Registry (docs/Jaafar-improve.md §5).
 *
 * Merges two sources into one capability list:
 * - the client's n8n instance credentials (type + name only, via the public
 *   API — secrets never leave n8n), joined with observed node types;
 * - platform Integration rows (provider + status).
 *
 * Results are cached per scope for 60s; `invalidate()` forces a refresh
 * (call after connecting/rotating credentials).
 */
@Injectable()
export class IntegrationRegistryService {
  private readonly logger = new Logger(IntegrationRegistryService.name);
  private readonly cache = new Map<string, RegistryCacheEntry>();

  constructor(
    private readonly connections: N8nConnectionsService,
    private readonly clientApi: N8nClientApiService,
    private readonly nodeInventory: N8nNodeInventoryService,
    private readonly integrations: IntegrationsService,
  ) {}

  async capabilitiesForScope(scope: IntegrationScope): Promise<IntegrationCapability[]> {
    const key = `${scope.organizationId ?? 'personal'}:${scope.userId ?? 'anonymous'}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.build(scope);
    this.cache.set(key, { expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS, value });
    return value;
  }

  invalidate(scope: IntegrationScope): void {
    this.cache.delete(`${scope.organizationId ?? 'personal'}:${scope.userId ?? 'anonymous'}`);
  }

  /** Normalizes an n8n credential type to a provider key. */
  providerForCredentialType(credentialType: string): string {
    const alias = CREDENTIAL_TYPE_ALIASES[credentialType];
    if (alias) return alias;
    return credentialType
      .replace(/(Trigger)?(OAuth2?|Api)+$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  // ── internals ──────────────────────────────────────────────

  private async build(scope: IntegrationScope): Promise<IntegrationCapability[]> {
    const [fromN8n, fromPlatform] = await Promise.all([
      this.fromN8nInstance(scope).catch((error) => {
        this.logger.warn({
          event: 'integrations.registry_n8n_failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return [] as IntegrationCapability[];
      }),
      this.fromPlatform(scope).catch(() => [] as IntegrationCapability[]),
    ]);

    // n8n credentials win on conflicts — they prove a working credential.
    const merged = new Map<string, IntegrationCapability>();
    for (const capability of fromPlatform) merged.set(capability.provider, capability);
    for (const capability of fromN8n) merged.set(capability.provider, capability);
    return [...merged.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }

  private async fromN8nInstance(scope: IntegrationScope): Promise<IntegrationCapability[]> {
    const resolved = await this.connections.resolveActiveForScope({
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    });
    if (!resolved) return [];
    const connection: N8nClientConnection = {
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
    };
    let credentials: Array<{ name: string; type: string }>;
    try {
      credentials = await this.clientApi.listCredentials(connection);
    } catch (error) {
      if (error instanceof N8nClientApiError) {
        this.logger.warn({
          event: 'integrations.registry_credentials_unavailable',
          code: error.code,
        });
        return [];
      }
      throw error;
    }
    const inventory = await this.nodeInventory.inventory(connection).catch(() => null);
    const nodeTypes = inventory?.nodeTypes.map((node) => node.type) ?? [];

    return credentials.map((credential) => {
      const provider = this.providerForCredentialType(credential.type);
      const normalized = normalizeProvider(provider);
      // Exact normalized suffix match first; prefix-tolerant match second.
      // Never the old loose substring `includes()` (false positives).
      const exact = nodeTypes.filter((type) => nodeSuffixMatch(type, normalized));
      const matched =
        exact.length > 0
          ? exact
          : nodeTypes.filter((type) => {
              const dot = type.lastIndexOf('.');
              const suffix = normalizeProvider(dot >= 0 ? type.slice(dot + 1) : type);
              return suffix.startsWith(normalized) || normalized.startsWith(suffix);
            });
      const suggested = SUGGESTED_NODE_TYPES[provider] ?? SUGGESTED_NODE_TYPES[normalized];
      return {
        provider,
        displayName: this.displayName(provider, credential.type),
        source: 'n8n' as const,
        connectionStatus: 'CONNECTED' as const,
        credentialsAvailable: true,
        credentialType: credential.type,
        nodeTypes: matched,
        ...(suggested ? { suggestedNodeType: suggested } : {}),
      } satisfies IntegrationCapability;
    });
  }

  private async fromPlatform(scope: IntegrationScope): Promise<IntegrationCapability[]> {
    if (!scope.organizationId) return [];
    const rows = await this.integrations.findByOrganization(scope.organizationId, {
      ...(scope.userId ? { userId: scope.userId } : {}),
      organizationId: scope.organizationId,
    });
    return rows.map((row) => {
      const provider = row.provider.toLowerCase();
      const suggested =
        SUGGESTED_NODE_TYPES[provider] ?? SUGGESTED_NODE_TYPES[normalizeProvider(provider)];
      return {
        provider,
        displayName: row.name,
        source: 'platform' as const,
        connectionStatus: row.status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED',
        credentialsAvailable: row.status === 'CONNECTED',
        ...(suggested ? { suggestedNodeType: suggested } : {}),
      };
    });
  }

  private displayName(provider: string, credentialType: string): string {
    const pretty = provider
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return pretty || credentialType;
  }
}
