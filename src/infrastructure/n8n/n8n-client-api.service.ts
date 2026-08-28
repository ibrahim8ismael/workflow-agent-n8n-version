import { lookup } from 'node:dns/promises';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** A verified n8n connection's resolved credentials. Never persisted in plaintext. */
export interface N8nClientConnection {
  baseUrl: string;
  apiKey: string;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  versionId?: string;
}

export interface N8nWebhookNode {
  method?: string;
  path: string;
}

export interface N8nWorkflowDetail extends N8nWorkflowSummary {
  nodes?: Array<{ type: string; parameters?: Record<string, unknown> }>;
}

export type N8nClientErrorCode = 'INVALID_CREDENTIALS' | 'UNREACHABLE' | 'API_ERROR';

export class N8nClientApiError extends Error {
  constructor(
    message: string,
    readonly code: N8nClientErrorCode,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = N8nClientApiError.name;
  }
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true; // unparseable → treat as private (deny)
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return true;
    value = ((value << 8) | octet) >>> 0;
  }
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10)
  return /^(f[cd]|fe[89ab])/.test(lower);
}

/**
 * Typed REST client for a CLIENT's own n8n instance public API.
 * Credentials are passed per call — no platform-global n8n configuration.
 * All target URLs pass an SSRF guard before any request is made.
 */
@Injectable()
export class N8nClientApiService {
  private readonly logger = new Logger(N8nClientApiService.name);

  constructor(private readonly config: ConfigService) {}

  /** Verifies the connection is reachable and the API key valid. */
  async verify(connection: N8nClientConnection): Promise<{ ok: true; version?: string }> {
    await this.listWorkflows(connection, 1);
    return { ok: true };
  }

  async listWorkflows(
    connection: N8nClientConnection,
    limit?: number,
  ): Promise<N8nWorkflowSummary[]> {
    const url = new URL(`${this.apiBase(connection.baseUrl)}/workflows`);
    if (limit !== undefined) url.searchParams.set('limit', String(limit));
    const data = await this.request<N8nWorkflowSummary[] | { data: N8nWorkflowSummary[] }>(
      connection,
      url,
    );
    return Array.isArray(data) ? data : (data.data ?? []);
  }

  async getWorkflow(connection: N8nClientConnection, id: string): Promise<N8nWorkflowDetail> {
    return this.request<N8nWorkflowDetail>(
      connection,
      new URL(`${this.apiBase(connection.baseUrl)}/workflows/${encodeURIComponent(id)}`),
    );
  }

  async createWorkflow(
    connection: N8nClientConnection,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      connection,
      new URL(`${this.apiBase(connection.baseUrl)}/workflows`),
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }

  async activateWorkflow(connection: N8nClientConnection, id: string): Promise<void> {
    await this.request<unknown>(
      connection,
      new URL(`${this.apiBase(connection.baseUrl)}/workflows/${encodeURIComponent(id)}/activate`),
      { method: 'POST' },
    );
  }

  /**
   * Extracts production webhook trigger paths from a workflow definition.
   * Used to bind an automation to a callable webhook.
   */
  static extractWebhookPaths(workflow: N8nWorkflowDetail): N8nWebhookNode[] {
    const nodes = workflow.nodes ?? [];
    return nodes
      .filter((node) => node.type === 'n8n-nodes-base.webhook')
      .map((node) => ({
        method:
          typeof node.parameters?.httpMethod === 'string' ? node.parameters.httpMethod : 'POST',
        path: typeof node.parameters?.path === 'string' ? node.parameters.path : '',
      }))
      .filter((hook) => hook.path.length > 0);
  }

  // ── internals ──────────────────────────────────────────────

  private apiBase(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/api/v1`;
  }

  private async request<T>(
    connection: N8nClientConnection,
    url: URL,
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    await this.assertSafeUrl(url);

    const timeoutMs = this.config.get<number>('N8N_TIMEOUT_MS') ?? 30_000;
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          'X-N8N-API-KEY': connection.apiKey,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new N8nClientApiError(`n8n instance unreachable: ${message}`, 'UNREACHABLE');
    }

    if (response.status === 401 || response.status === 403) {
      throw new N8nClientApiError('n8n API key rejected', 'INVALID_CREDENTIALS', response.status);
    }
    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { message?: string };
        if (body && typeof body.message === 'string') detail = `: ${body.message}`;
      } catch {
        // non-JSON error body
      }
      throw new N8nClientApiError(
        `n8n API returned HTTP ${response.status}${detail}`,
        'API_ERROR',
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new N8nClientApiError('n8n API returned a non-JSON response', 'API_ERROR');
    }
  }

  /** SSRF guard: scheme allowlist + private-network denylist, resolving DNS before the check. */
  private async assertSafeUrl(url: URL): Promise<void> {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new N8nClientApiError(`Blocked n8n connection protocol ${url.protocol}`, 'API_ERROR');
    }
    const isLocalhost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname.endsWith('.localhost');
    const allowPrivate = isLocalhost && !this.isProduction();
    if (url.protocol === 'http:' && !allowPrivate && this.isProduction()) {
      throw new N8nClientApiError(
        'Plain HTTP is only allowed for localhost connections',
        'API_ERROR',
      );
    }

    if (allowPrivate) return;

    let addresses: string[];
    try {
      const result = await lookup(url.hostname, { all: true, verbatim: true });
      addresses = result.map((entry) => entry.address);
    } catch {
      throw new N8nClientApiError(`Cannot resolve n8n host ${url.hostname}`, 'UNREACHABLE');
    }

    for (const address of addresses) {
      if (address.includes(':') ? isPrivateIpv6(address) : isPrivateIpv4(address)) {
        this.logger.warn({ event: 'n8n.ssrf_blocked', hostname: url.hostname, address });
        throw new N8nClientApiError(
          'Blocked n8n connection to a private network address',
          'API_ERROR',
        );
      }
    }
  }

  private isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
  }
}
