import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationRuntimeService } from './conversation/conversation-runtime.service';
import { EmployeeDesignRuntimeService } from './employee-design/employee-design-runtime.service';
import { RuntimeRouterService } from './runtime-router.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeMode } from './types/runtime.types';

describe('RuntimeRouterService', () => {
  const conversationRuntime = { run: vi.fn() } as unknown as ConversationRuntimeService;
  const employeeDesignRuntime = { run: vi.fn() } as unknown as EmployeeDesignRuntimeService;
  const executionRuntime = { execute: vi.fn() } as unknown as RuntimeService;
  const router = new RuntimeRouterService(
    conversationRuntime,
    employeeDesignRuntime,
    executionRuntime,
  );
  const request = {
    agentId: 'agent-1',
    userMessage: 'Hello',
    mode: RuntimeMode.CONVERSATION,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes conversation requests without invoking execution', async () => {
    vi.mocked(conversationRuntime.run).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run(request);

    expect(conversationRuntime.run).toHaveBeenCalledWith(request);
    expect(executionRuntime.execute).not.toHaveBeenCalled();
  });

  it('routes execution requests to the existing execution runtime', async () => {
    vi.mocked(executionRuntime.execute).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run({ ...request, mode: RuntimeMode.EXECUTION });

    expect(executionRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: RuntimeMode.EXECUTION }),
    );
    expect(conversationRuntime.run).not.toHaveBeenCalled();
  });

  it('routes employee design requests without invoking execution', async () => {
    vi.mocked(employeeDesignRuntime.run).mockResolvedValue({ runId: 'run-1' } as never);

    await router.run({ ...request, mode: RuntimeMode.EMPLOYEE_DESIGN });

    expect(employeeDesignRuntime.run).toHaveBeenCalled();
    expect(executionRuntime.execute).not.toHaveBeenCalled();
  });

  it('rejects unknown runtime modes', () => {
    expect(() => router.run({ ...request, mode: 'unknown' as RuntimeMode })).toThrow(
      BadRequestException,
    );
  });
});
