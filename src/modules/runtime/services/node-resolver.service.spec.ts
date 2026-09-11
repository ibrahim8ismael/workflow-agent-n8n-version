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
