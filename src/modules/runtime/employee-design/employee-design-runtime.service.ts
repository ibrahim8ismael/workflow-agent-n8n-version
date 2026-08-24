import { Injectable, Logger } from '@nestjs/common';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  BLUEPRINT_GENERATOR_SYSTEM_PROMPT,
  JAAFAR_IDENTITY_SYSTEM_PROMPT,
  TOOL_USE_POLICY_SYSTEM_PROMPT,
} from '../../../infrastructure/prompts/system-prompts';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { MemoryService } from '../../memory/services/memory.service';
import { RunsService } from '../../runs/runs.service';
import { ContextBuilderService } from '../services/context-builder.service';
import type { ExecuteResponse } from '../services/runtime.service';
import { runtimeUserErrorMessage } from '../shared/runtime-user-message';
import type { RuntimeRequest } from '../types/runtime.types';
import { blueprintSchema, type EmployeeBlueprint } from './employee-blueprint.schema';
import { validateEmployeeBlueprint } from './employee-blueprint.validation';
import { blueprintRevision } from './employee-blueprint-revision';

export type { EmployeeBlueprint } from './employee-blueprint.schema';
export { blueprintSchema } from './employee-blueprint.schema';

@Injectable()
export class EmployeeDesignRuntimeService {
  private readonly logger = new Logger(EmployeeDesignRuntimeService.name);

  constructor(
    private readonly runsService: RunsService,
    private readonly agentsService: AgentsService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly llmRuntime: LLMRuntimeService,
  ) {}

  async run(request: RuntimeRequest): Promise<ExecuteResponse> {
    const run = await this.runsService.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: request.mode, designStatus: 'DRAFT', approvalStatus: 'PENDING' },
    });

    try {
      await this.runsService.transitionStatus(run.id, 'PREPARING');
      const agent = await this.agentsService.findById(request.agentId);
      const conversation = request.conversationId
        ? await this.conversationsService.findById(request.conversationId)
        : undefined;
      const session = (conversation?.metadata as Record<string, unknown> | null)?.employeeDesign as
        | Record<string, unknown>
        | undefined;
      const organizationId = request.organizationId ?? agent.organizationId ?? undefined;
      const history = request.conversationId
        ? (await this.conversationsService.getMessages(request.conversationId, { take: 20 })).map(
            (message) => ({ role: message.role, content: message.content }),
          )
        : [];
      const context = await this.contextBuilder.build({
        systemPrompt: `${JAAFAR_IDENTITY_SYSTEM_PROMPT}\n\n${TOOL_USE_POLICY_SYSTEM_PROMPT}\n\n${BLUEPRINT_GENERATOR_SYSTEM_PROMPT}\n\nCurrent design session:\n${JSON.stringify(session ?? {})}\n\nEmployee policies:\n${agent.instructions ?? ''}`,
        agentId: request.agentId,
        conversationId: request.conversationId,
        organizationId,
        userId: request.userId,
        userMessage: request.userMessage,
        conversationHistory: history,
      });
      const result = await this.llmRuntime.generateObject({
        mode: request.effort ?? 'medium',
        systemPrompt: context.system,
        messages: context.messages.map((message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content: message.content,
        })),
        schema: blueprintSchema,
        temperature: 0.2,
        maxTokens: 2000,
      });
      const blueprint = blueprintSchema.parse(result.object);
      const validation = validateEmployeeBlueprint(blueprint);
      const ready =
        blueprint.ready && validation.valid && blueprint.missingRequirements.length === 0;
      const missingRequirements = ready
        ? blueprint.missingRequirements
        : Array.from(new Set([...blueprint.missingRequirements, ...validation.missing]));

      await this.runsService.updateUsage(run.id, result.usage);
      await this.runsService.updateMetadata(run.id, {
        blueprint: { ...blueprint, ready, missingRequirements },
        designStatus: ready ? 'READY_FOR_REVIEW' : 'GATHERING_REQUIREMENTS',
        approvalStatus: ready ? 'READY' : 'NOT_READY',
        missingRequirements,
        execution: result.execution,
      });
      if (request.conversationId) {
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'user',
          content: request.userMessage,
        });
        await this.conversationsService.titleFromFirstMessage(
          request.conversationId,
          request.userMessage,
        );
      }
      const updatedBlueprint = { ...blueprint, ready, missingRequirements };
      const revision = blueprintRevision(updatedBlueprint);
      await this.runsService.updateMetadata(run.id, { blueprintRevision: revision });
      const response = this.formatSummary(updatedBlueprint);
      if (request.conversationId) {
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'assistant',
          content: response,
        });
        await this.conversationsService.updateMetadata(request.conversationId, {
          employeeDesign: {
            status: ready ? 'READY_FOR_REVIEW' : 'GATHERING_REQUIREMENTS',
            approvalStatus: ready ? 'READY' : 'NOT_READY',
            blueprint: updatedBlueprint,
            blueprintRevision: revision,
            missingRequirements,
            sourceConversationId: request.conversationId,
            sourceDesignRunId: run.id,
          },
        });
      }
      const completed = await this.runsService.complete(run.id, response);

      return {
        runId: completed.id,
        mode: request.mode,
        status: 'COMPLETED',
        response,
        plan: { ...updatedBlueprint, blueprintRevision: revision },
        usage: {
          promptTokens: completed.promptTokens,
          completionTokens: completed.completionTokens,
          totalTokens: completed.totalTokens,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Employee design run ${run.id} failed: ${message}`);
      await this.runsService.fail(run.id, message);
      return {
        runId: run.id,
        mode: request.mode,
        status: 'FAILED',
        response: runtimeUserErrorMessage(error),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async confirm(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
    options?: { blueprintRevision?: string },
  ): Promise<ExecuteResponse> {
    const run = await this.runsService.findById(runId);
    if (scope && run.userId && run.userId !== scope.userId) {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: 'This employee plan is not available in the current user scope.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (scope && run.organizationId && run.organizationId !== scope.organizationId) {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: 'This employee plan is not available in the current organization scope.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    let metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    if (typeof metadata.blueprint === 'undefined' && run.conversationId) {
      try {
        const conv = await this.conversationsService.findById(run.conversationId);
        const convMeta = (conv.metadata as Record<string, unknown> | null) ?? {};
        const design = convMeta.employeeDesign as Record<string, unknown> | undefined;
        if (design?.blueprint) {
          metadata = {
            ...metadata,
            blueprint: design.blueprint,
            designStatus: design.status ?? metadata.designStatus ?? 'READY_FOR_REVIEW',
            approvalStatus: design.approvalStatus ?? metadata.approvalStatus ?? 'READY',
            blueprintRevision: design.blueprintRevision ?? metadata.blueprintRevision,
            runtimeMode: 'employee_design',
          };
          await this.runsService.updateMetadata(runId, metadata);
        }
      } catch {
        // ignore conversation lookup error
      }
    }

    if (typeof metadata.createdAgentId === 'string') {
      const existingAgent = await this.agentsService.findById(metadata.createdAgentId);
      return {
        runId,
        mode: 'employee_design',
        status: 'COMPLETED',
        response: `Employee draft "${existingAgent.name}" was already created and is ready for configuration.`,
        plan: {
          ...(metadata.blueprint as Record<string, unknown>),
          agentId: existingAgent.id,
          blueprintRevision: metadata.blueprintRevision,
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    if (typeof metadata.blueprint === 'undefined') {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: 'This confirmation does not belong to an employee design plan.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (metadata.approvalStatus === 'REJECTED') {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: 'This employee draft is not waiting for confirmation.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    const blueprint = blueprintSchema.parse(metadata.blueprint);
    const currentRevision =
      typeof metadata.blueprintRevision === 'string'
        ? metadata.blueprintRevision
        : blueprintRevision(blueprint);
    if (options?.blueprintRevision && options.blueprintRevision !== currentRevision) {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response:
          'This employee plan has changed. Review the latest blueprint before confirming it.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const validation = validateEmployeeBlueprint(blueprint);
    if (!validation.valid) {
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: `This employee plan still needs:\n${validation.missing.map((item) => `- ${item}`).join('\n')}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const claimed = await this.runsService.claimEmployeeCreation(runId);
    if (!claimed) {
      const currentRun = await this.runsService.findById(runId);
      const currentMetadata = (currentRun.metadata as Record<string, unknown> | null) ?? {};
      if (typeof currentMetadata.createdAgentId === 'string') {
        const existingAgent = await this.agentsService.findById(currentMetadata.createdAgentId);
        return {
          runId,
          mode: 'employee_design',
          status: 'COMPLETED',
          response: `Employee draft "${existingAgent.name}" was already created and is ready for configuration.`,
          plan: { ...blueprint, agentId: existingAgent.id, blueprintRevision: currentRevision },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
      return {
        runId,
        mode: 'employee_design',
        status: 'WAITING',
        response: 'This employee plan is already being processed. Please try again shortly.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const approvedMetadata = {
      ...metadata,
      approvalStatus: 'APPROVED',
      approvedAt: metadata.approvedAt ?? new Date().toISOString(),
    };
    await this.runsService.updateMetadata(runId, approvedMetadata);
    let agent: Awaited<ReturnType<AgentsService['create']>>;
    try {
      agent = await this.agentsService.create({
        name: blueprint.name,
        description: blueprint.description,
        instructions: blueprint.instructions,
        status: 'DRAFT',
        model: 'gpt-4o',
        userId: run.userId ?? undefined,
        organizationId: run.organizationId ?? undefined,
      });
    } catch (error) {
      await this.runsService.updateMetadata(runId, {
        ...metadata,
        designStatus: 'READY_FOR_REVIEW',
        approvalStatus: 'READY',
      });
      this.logger.error(`Employee creation for design run ${runId} failed`, error);
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response: runtimeUserErrorMessage(error),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    await this.runsService.updateMetadata(runId, {
      ...approvedMetadata,
      createdAgentId: agent.id,
    });

    await this.memoryService.upsert(
      agent.id,
      'employee-profile',
      'AGENT',
      JSON.stringify({
        name: blueprint.name,
        description: blueprint.description,
        role: blueprint.role,
        department: blueprint.department,
        memoryPolicy: blueprint.memoryPolicy,
        responsibilities: blueprint.responsibilities,
        goals: blueprint.goals,
      }),
      { source: 'employee-design-confirmation', designRunId: runId },
    );
    await this.runsService.updateMetadata(runId, {
      ...approvedMetadata,
      designStatus: 'CREATED',
      createdAgentId: agent.id,
    });
    if (run.conversationId) {
      await this.conversationsService.updateMetadata(run.conversationId, {
        employeeDesign: {
          status: 'CREATED',
          approvalStatus: 'APPROVED',
          blueprint,
          createdEmployeeId: agent.id,
          sourceConversationId: run.conversationId,
          sourceDesignRunId: runId,
        },
      });
    }

    return {
      runId,
      mode: 'employee_design',
      status: 'COMPLETED',
      response: `Employee draft "${agent.name}" was created and is ready for configuration.`,
      plan: { ...blueprint, agentId: agent.id, blueprintRevision: currentRevision },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private formatSummary(blueprint: EmployeeBlueprint): string {
    if (!blueprint.ready) {
      return [
        'I need a little more information before I can prepare the employee draft:',
        '',
        ...blueprint.missingRequirements.map((item) => `- ${item}`),
      ].join('\n');
    }

    return (
      `Draft employee blueprint: ${blueprint.name}\n\n${blueprint.summary}\n\n` +
      `Responsibilities:\n${blueprint.responsibilities.map((item) => `- ${item}`).join('\n')}\n\n` +
      'The blueprint is ready! Click "Start Process" above the chat to create and activate your new employee.'
    );
  }
}
