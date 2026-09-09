import { Injectable } from '@nestjs/common';

export type NodeResolverKind = 'native' | 'http' | 'code';

export interface NodeResolverOverride {
  requested: boolean;
  type?: 'httpRequest' | 'code';
}

export interface NodeResolverNodeType {
  type: string;
  typeVersion?: number;
}

export interface NodeResolverCapability {
  provider: string;
  connectionStatus?: string;
  credentialsAvailable?: boolean;
  suggestedNodeType?: string;
  nodeTypes?: string[];
}

export interface ResolveNodeInput {
  integration?: string;
  operation?: string;
  instanceNodeTypes: NodeResolverNodeType[];
  capabilities?: NodeResolverCapability[];
  /**
   * Curated operation lists keyed by normalized provider. Absence of an
   * entry means unverified (NOT unsupported) — see plan §3/§6.
   */
  knownOperations?: Record<string, string[]>;
  override?: NodeResolverOverride;
  /** Pure transform/logic step with no integration — always Code. */
  isLogicOnly?: boolean;
}

export interface ResolveNodeResult {
  kind: NodeResolverKind;
  nodeType?: string;
  operationVerified: boolean;
  reason: string;
}

const GENERIC_TYPES = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.code']);

const STRUCTURAL_TYPES = [
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.code',
  'n8n-nodes-base.set',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.if',
  'n8n-nodes-base.dataTable',
];

/** Well-known providers the resolver can name even before a capability row exists. */
const KNOWN_PROVIDERS = [
  'whatsapp',
  'slack',
  'gmail',
  'telegram',
  'hubspot',
  'salesforce',
  'zoho',
  'pipedrive',
  'notion',
  'airtable',
  'sheet',
  'shopify',
  'stripe',
  'outlook',
  'discord',
  'openai',
  'postgres',
  'mysql',
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nodeSuffix(nodeType: string): string {
  const dot = nodeType.lastIndexOf('.');
  return normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
}

/**
 * NodeResolver — pure decision layer (plan §4).
 *
 * No LLM, no DB, no n8n calls, no cache. It receives already-loaded
 * inventory + capability data and returns the recommended node choice.
 * Unverified does NOT mean unsupported: a native node with unknown
 * operation coverage is still preferred, with a reason.
 */
@Injectable()
export class NodeResolverService {
  resolveNode(input: ResolveNodeInput): ResolveNodeResult {
    if (input.isLogicOnly && !input.integration) {
      return {
        kind: 'code',
        nodeType: 'n8n-nodes-base.code',
        operationVerified: true,
        reason: 'Pure transformation/logic step with no integration.',
      };
    }
    if (input.override?.requested) {
      if (input.override.type === 'code') {
        return {
          kind: 'code',
          nodeType: 'n8n-nodes-base.code',
          operationVerified: true,
          reason: 'The user explicitly requested the Code node.',
        };
      }
      return {
        kind: 'http',
        nodeType: 'n8n-nodes-base.httpRequest',
        operationVerified: true,
        reason: 'The user explicitly requested direct HTTP/API usage.',
      };
    }
    const integration = input.integration?.trim();
    if (!integration) {
      return {
        kind: 'code',
        nodeType: 'n8n-nodes-base.code',
        operationVerified: true,
        reason: 'No integration requested; generic logic node applies.',
      };
    }
    const candidate = this.findNativeCandidate(
      integration,
      input.instanceNodeTypes,
      input.capabilities ?? [],
    );
    if (!candidate) {
      return {
        kind: 'http',
        nodeType: 'n8n-nodes-base.httpRequest',
        operationVerified: false,
        reason: `No compatible native node for "${integration}" in the connected n8n instance.`,
      };
    }
    const provider = normalize(integration);
    const known = input.knownOperations?.[provider];
    const operation = input.operation?.trim();
    if (!operation || !known) {
      return {
        kind: 'native',
        nodeType: candidate,
        operationVerified: false,
        reason: `Native node ${candidate} is available in the connected n8n instance${operation ? `; operation "${operation}" is not covered by the current operation schema` : ''}.`,
      };
    }
    const supported = known.some((op) => normalize(op) === normalize(operation));
    if (supported) {
      return {
        kind: 'native',
        nodeType: candidate,
        operationVerified: true,
        reason: `Native node ${candidate} supports "${operation}" in the connected n8n instance.`,
      };
    }
    return {
      kind: 'http',
      nodeType: 'n8n-nodes-base.httpRequest',
      operationVerified: true,
      reason: `Native node ${candidate} exists but the requested operation "${operation}" is verified as unsupported.`,
    };
  }

  /**
   * Relevant-node filtering for the planner prompt (plan §6): natives
   * matching detected providers first, then capability nodes, then
   * structural plumbing. Soft cap ~20; relevant natives are never dropped
   * for the cap.
   */
  filterRelevantNodes(input: {
    entities?: string[];
    actions?: string[];
    conditions?: string[];
    instanceNodeTypes: NodeResolverNodeType[];
    capabilities?: NodeResolverCapability[];
    softCap?: number;
  }): string[] {
    const cap = input.softCap ?? 20;
    const haystack = [
      ...(input.entities ?? []),
      ...(input.actions ?? []),
      ...(input.conditions ?? []),
    ]
      .join(' ')
      .toLowerCase();
    const detected = new Set<string>();
    for (const provider of KNOWN_PROVIDERS) {
      if (haystack.includes(provider)) detected.add(provider);
    }
    for (const capability of input.capabilities ?? []) {
      const provider = normalize(capability.provider);
      if (!provider) continue;
      if (haystack.includes(capability.provider.toLowerCase().replace(/_/g, ''))) {
        detected.add(provider);
      }
    }
    const available = new Map<string, string>();
    for (const node of input.instanceNodeTypes) {
      if (!available.has(node.type)) available.set(node.type, node.type);
    }
    const picked: string[] = [];
    const push = (type: string) => {
      if (!available.has(type) || picked.includes(type)) return;
      picked.push(type);
    };
    // 1) natives matching detected providers (via suffix or capability hints)
    for (const provider of detected) {
      for (const node of input.instanceNodeTypes) {
        const suffix = nodeSuffix(node.type);
        if (suffix === provider || suffix.startsWith(provider) || provider.startsWith(suffix)) {
          push(node.type);
        }
      }
      for (const capability of input.capabilities ?? []) {
        if (normalize(capability.provider) !== provider) continue;
        if (capability.suggestedNodeType) push(capability.suggestedNodeType);
        for (const nodeType of capability.nodeTypes ?? []) push(nodeType);
      }
    }
    // 2) nodes for every connected capability (even if not named in text)
    for (const capability of input.capabilities ?? []) {
      if (capability.suggestedNodeType) push(capability.suggestedNodeType);
      for (const nodeType of capability.nodeTypes ?? []) push(nodeType);
    }
    // 3) structural plumbing
    for (const structural of STRUCTURAL_TYPES) push(structural);
    // Relevant natives first; structural tail may be trimmed by the soft cap,
    // but detected natives are preserved.
    const structuralTail = picked.filter((type) => STRUCTURAL_TYPES.includes(type));
    const natives = picked.filter((type) => !STRUCTURAL_TYPES.includes(type));
    if (natives.length >= cap) return natives.slice(0, Math.max(cap, natives.length));
    return [...natives, ...structuralTail].slice(0, cap);
  }

  /** True for the generic fallbacks the native-first policy polices. */
  isGenericNodeType(nodeType: string | undefined): boolean {
    return !!nodeType && GENERIC_TYPES.has(nodeType);
  }

  private findNativeCandidate(
    integration: string,
    instanceNodeTypes: NodeResolverNodeType[],
    capabilities: NodeResolverCapability[],
  ): string | undefined {
    const provider = normalize(integration);
    // 1) explicit capability hint wins (registry is the mapping owner)
    for (const capability of capabilities) {
      if (normalize(capability.provider) !== provider) continue;
      if (
        capability.suggestedNodeType &&
        instanceNodeTypes.some((n) => n.type === capability.suggestedNodeType)
      ) {
        return capability.suggestedNodeType;
      }
      const hinted = (capability.nodeTypes ?? []).find((nodeType) =>
        instanceNodeTypes.some((n) => n.type === nodeType),
      );
      if (hinted) return hinted;
      // Capability proves the provider is connected; a same-suffix instance
      // node is the native even without an explicit hint list.
      const bySuffix = instanceNodeTypes.find((n) => nodeSuffix(n.type) === provider);
      if (bySuffix && capability.credentialsAvailable !== false) return bySuffix.type;
    }
    // 2) exact suffix match against the instance inventory
    const exact = instanceNodeTypes.find((n) => nodeSuffix(n.type) === provider);
    if (exact && !GENERIC_TYPES.has(exact.type)) return exact.type;
    return undefined;
  }
}
