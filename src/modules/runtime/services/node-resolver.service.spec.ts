import { describe, expect, it } from 'vitest';
import { NodeResolverService } from './node-resolver.service';

const instance = [
  { type: 'n8n-nodes-base.webhook' },
  { type: 'n8n-nodes-base.whatsApp', typeVersion: 1 },
  { type: 'n8n-nodes-base.hubSpot', typeVersion: 4 },
  { type: 'n8n-nodes-base.code' },
  { type: 'n8n-nodes-base.httpRequest' },
];

const capabilities = [
  { provider: 'whatsapp', suggestedNodeType: 'n8n-nodes-base.whatsApp' },
  {
    provider: 'hubspot',
    suggestedNodeType: 'n8n-nodes-base.hubSpot',
    nodeTypes: ['n8n-nodes-base.hubSpot'],
  },
];

describe('NodeResolverService', () => {
  const service = new NodeResolverService();

  it('prefers the native node when available and the operation is verified', () => {
    const result = service.resolveNode({
      integration: 'whatsapp',
      operation: 'sendMessage',
      instanceNodeTypes: instance,
      capabilities,
      knownOperations: { whatsapp: ['sendMessage', 'sendTemplate'] },
    });

    expect(result).toMatchObject({
      kind: 'native',
      nodeType: 'n8n-nodes-base.whatsApp',
      operationVerified: true,
    });
  });

  it('still prefers native with a reason when the operation is unverified', () => {
    const result = service.resolveNode({
      integration: 'whatsapp',
      operation: 'sendMessage',
      instanceNodeTypes: instance,
      capabilities,
    });

    expect(result.kind).toBe('native');
    expect(result.nodeType).toBe('n8n-nodes-base.whatsApp');
    expect(result.operationVerified).toBe(false);
    expect(result.reason).toContain('not covered');
  });

  it('falls back to HTTP when the operation is verified unsupported', () => {
    const result = service.resolveNode({
      integration: 'hubspot',
      operation: 'sendMessage',
      instanceNodeTypes: instance,
      capabilities,
      knownOperations: { hubspot: ['create', 'update'] },
    });

    expect(result.kind).toBe('http');
    expect(result.operationVerified).toBe(true);
    expect(result.reason).toContain('verified as unsupported');
  });

  it('falls back to HTTP when no native node exists', () => {
    const result = service.resolveNode({
      integration: 'customApi',
      operation: 'fetch',
      instanceNodeTypes: instance,
      capabilities,
    });

    expect(result.kind).toBe('http');
    expect(result.reason).toContain('No compatible native node');
  });

  it('honors an explicit HTTP override even when native exists', () => {
    const result = service.resolveNode({
      integration: 'whatsapp',
      operation: 'sendMessage',
      instanceNodeTypes: instance,
      capabilities,
      override: { requested: true, type: 'httpRequest' },
    });

    expect(result.kind).toBe('http');
    expect(result.reason).toContain('explicitly requested');
  });

  it('honors an explicit Code override', () => {
    const result = service.resolveNode({
      integration: 'hubspot',
      instanceNodeTypes: instance,
      capabilities,
      override: { requested: true, type: 'code' },
    });

    expect(result.kind).toBe('code');
  });

  it('resolves pure logic steps to Code', () => {
    const result = service.resolveNode({ instanceNodeTypes: instance, isLogicOnly: true });

    expect(result).toMatchObject({ kind: 'code', nodeType: 'n8n-nodes-base.code' });
  });

  it('filters relevant nodes to a targeted set with natives first', () => {
    const types = service.filterRelevantNodes({
      entities: ['WhatsApp'],
      actions: ['send the customer a message'],
      conditions: [],
      instanceNodeTypes: [...instance, { type: 'n8n-nodes-base.slack' }],
      capabilities,
    });

    expect(types).toContain('n8n-nodes-base.whatsApp');
    expect(types.length).toBeLessThanOrEqual(20);
    expect(types.indexOf('n8n-nodes-base.whatsApp')).toBeLessThan(
      types.indexOf('n8n-nodes-base.code'),
    );
  });
});
