import { describe, expect, it } from 'vitest';
import { ToolManifestService } from './tool-manifest.service';

describe('ToolManifestService', () => {
  it('loads the Jaafar tool manifest and validates its contracts', () => {
    const service = new ToolManifestService();

    expect(service.require('knowledge_search').woops.kind).toBe('read');
    expect(service.require('employee_create_draft').woops.approval).toBe('required');
    expect(service.require('human_approval').woops.approval).toBe('required');
  });

  it('returns only implemented tools available in a mode by default', () => {
    const service = new ToolManifestService();
    const tools = service.list({ mode: 'employee_design' });

    expect(tools.map((tool) => tool.function.name)).toEqual([
      'knowledge_search',
      'memory_search',
      'employee_get',
      'employee_skills_list',
      'employee_blueprint_prepare',
      'employee_create_draft',
      'human_approval',
    ]);
    expect(tools.some((tool) => tool.function.name === 'skill_proposal_prepare')).toBe(false);
  });

  it('can expose planned tools for administrative inspection without making them executable', () => {
    const service = new ToolManifestService();

    expect(service.list({ mode: 'execution', includeUnimplemented: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'employee_publish' }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({ name: 'employee_activate' }),
        }),
      ]),
    );
    expect(service.list({ mode: 'execution' })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'employee_publish' }),
        }),
      ]),
    );
  });
});
