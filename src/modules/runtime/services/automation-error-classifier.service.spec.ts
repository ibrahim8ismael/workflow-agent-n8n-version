import { describe, expect, it } from 'vitest';
import { N8nClientApiError } from '../../../infrastructure/n8n/n8n-client-api.service';
import { N8nWorkflowError } from '../../../infrastructure/n8n/n8n-workflow-executor.service';
import { AutomationErrorClassifierService } from './automation-error-classifier.service';

describe('AutomationErrorClassifierService', () => {
  const service = new AutomationErrorClassifierService();

  it('maps rejected API keys to CREDENTIAL_ERROR with a user action', () => {
    const classified = service.classify(
      new N8nClientApiError('n8n API key rejected', 'INVALID_CREDENTIALS', 401),
      'provision',
    );

    expect(classified).toMatchObject({
      code: 'CREDENTIAL_ERROR',
      retryable: false,
      repairStrategy: 'fix_credentials',
    });
    expect(classified.userAction).toContain('Reconnect');
    expect(classified.summary).toContain('provision');
  });

  it('maps rate limits and timeouts to retryable strategies', () => {
    expect(
      service.classify(new N8nWorkflowError('n8n workflow returned HTTP 429', true, 429), 'test'),
    ).toMatchObject({ code: 'RATE_LIMIT', retryable: true, repairStrategy: 'retry_execution' });
    expect(
      service.classify(new Error('LLM execution timed out after 60000ms'), 'test'),
    ).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('maps instance outages to retryable API_ERROR', () => {
    expect(service.classify(new Error('fetch failed: ECONNREFUSED'), 'verify')).toMatchObject({
      code: 'API_ERROR',
      retryable: true,
      repairStrategy: 'retry_execution',
    });
    expect(
      service.classify(
        new N8nClientApiError('n8n API returned HTTP 502', 'API_ERROR', 502),
        'test',
      ),
    ).toMatchObject({ code: 'API_ERROR', retryable: true });
  });

  it('maps validation and expression failures to plan/expression repair', () => {
    expect(
      service.classify(new Error('Automation plan failed static validation: bad node'), 'build'),
    ).toMatchObject({ code: 'INVALID_CONFIGURATION', repairStrategy: 'replan_step' });
    expect(
      service.classify(new Error('Step "Log" has unbalanced expression delimiters'), 'build'),
    ).toMatchObject({ code: 'INVALID_EXPRESSION', repairStrategy: 'patch_expression' });
  });

  it('maps permission and missing-data failures', () => {
    expect(service.classify(new Error('Zoho API: permission denied'), 'test')).toMatchObject({
      code: 'PERMISSION_ERROR',
      userAction: expect.stringContaining('permission'),
    });
    expect(service.classify(new Error('data table "log" not found'), 'provision')).toMatchObject({
      code: 'MISSING_DATA',
      repairStrategy: 'adjust_config',
    });
  });

  it('maps 4xx rejections to LOGIC_ERROR and the truly unknown to UNKNOWN', () => {
    expect(
      service.classify(new N8nWorkflowError('n8n workflow returned HTTP 422', false, 422), 'test'),
    ).toMatchObject({ code: 'LOGIC_ERROR', repairStrategy: 'replan_step' });
    expect(service.classify(new Error('something deeply weird happened'), 'test')).toMatchObject({
      code: 'UNKNOWN',
      repairStrategy: 'escalate',
    });
  });
});
