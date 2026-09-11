import { Injectable } from '@nestjs/common';

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
}
