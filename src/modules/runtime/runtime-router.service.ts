import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentsService } from '../agents/services/agents.service';
import { ConversationsService } from '../conversations/services/conversations.service';
import { PlannerService } from '../planner/planner.service';
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
    private readonly plannerService: PlannerService,
    private readonly agentsService: AgentsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async run(request: RuntimeRequest): Promise<ExecuteResponse> {
    switch (request.mode) {
      case RuntimeMode.CONVERSATION:
        return this.routeConversation(request);
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

  private async routeConversation(request: RuntimeRequest): Promise<ExecuteResponse> {
    const agent = await this.agentsService.findById(request.agentId, false, {
      userId: request.userId,
      organizationId: request.organizationId,
    });
    const history = request.conversationId
      ? (await this.conversationsService.getMessages(request.conversationId, { take: 20 })).map(
          (message) => ({ role: message.role, content: message.content }),
        )
      : [];
    const plan = await this.plannerService.createPlan({
      userMessage: request.userMessage,
      agentId: request.agentId,
      agentInstructions: agent.instructions ?? undefined,
      conversationId: request.conversationId,
      organizationId: request.organizationId ?? agent.organizationId ?? undefined,
      availableSkills: [],
      conversationHistory: history,
      effort: request.effort ?? 'medium',
    });

    if (plan.intent === 'employee_design') {
      return this.employeeDesignRuntime.run({ ...request, mode: RuntimeMode.EMPLOYEE_DESIGN });
    }
    return this.conversationRuntime.run(request);
  }

  stream(request: RuntimeRequest): AsyncGenerator<ConversationStreamEvent> {
    if (request.mode !== RuntimeMode.CONVERSATION) {
      throw new BadRequestException('Streaming is currently supported only for conversation mode');
    }
    return this.conversationRuntime.stream(request);
  }

  confirmEmployeeDesign(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<ExecuteResponse> {
    return this.employeeDesignRuntime.confirm(runId, scope);
  }

  private async withMode(
    result: Promise<ExecuteResponse>,
    mode: RuntimeMode,
  ): Promise<ExecuteResponse> {
    return { ...(await result), mode };
  }
}
