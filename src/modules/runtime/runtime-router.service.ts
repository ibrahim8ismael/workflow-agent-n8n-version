import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ConversationRuntimeService,
  type ConversationStreamEvent,
} from './conversation/conversation-runtime.service';
import { EmployeeDesignRuntimeService } from './employee-design/employee-design-runtime.service';
import type { ExecuteRequest, ExecuteResponse } from './services/runtime.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeMode, type RuntimeRequest } from './types/runtime.types';

@Injectable()
export class RuntimeRouterService {
  constructor(
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly employeeDesignRuntime: EmployeeDesignRuntimeService,
    private readonly executionRuntime: RuntimeService,
  ) {}

  run(request: RuntimeRequest): Promise<ExecuteResponse> {
    switch (request.mode) {
      case RuntimeMode.CONVERSATION:
        return this.conversationRuntime.run(request);
      case RuntimeMode.EXECUTION:
        return this.withMode(
          this.executionRuntime.execute(request as ExecuteRequest),
          request.mode,
        );
      case RuntimeMode.EMPLOYEE_DESIGN:
        return this.employeeDesignRuntime.run(request);
      default:
        throw new BadRequestException(`Unsupported runtime mode: ${String(request.mode)}`);
    }
  }

  stream(request: RuntimeRequest): AsyncGenerator<ConversationStreamEvent> {
    if (request.mode !== RuntimeMode.CONVERSATION) {
      throw new BadRequestException('Streaming is currently supported only for conversation mode');
    }
    return this.conversationRuntime.stream(request);
  }

  private async withMode(
    result: Promise<ExecuteResponse>,
    mode: RuntimeMode,
  ): Promise<ExecuteResponse> {
    return { ...(await result), mode };
  }
}
