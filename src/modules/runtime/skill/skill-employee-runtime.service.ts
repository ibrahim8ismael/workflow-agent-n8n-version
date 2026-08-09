import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { buildSkillSystemPrompt } from '../../../infrastructure/prompts/system-prompts';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import type { PlanStep } from '../../planner/interfaces/plan.interface';
import { SKILL_EXECUTION_MODE } from '../../skills/constants/skill.constants';
import { SkillRuntimeError } from './skill-runtime.errors';

export interface SkillManifest {
  id: string;
  skillId: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  executionMode: string;
  instructions?: string;
  timeout?: number;
  retryPolicy?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
}

export interface SkillRuntimeRequest {
  agentId: string;
  userMessage: string;
  userId?: string;
  organizationId?: string;
}

@Injectable()
export class SkillEmployeeRuntimeService {
  private readonly logger = new Logger(SkillEmployeeRuntimeService.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly memoryService: MemoryService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    step: PlanStep,
    skill: SkillManifest | undefined,
    args: Record<string, unknown>,
    request: SkillRuntimeRequest,
  ): Promise<unknown> {
    this.validateManifest(skill, step);
    this.validateInput(skill, args);
    this.logger.log({ event: 'skill.started', skillId: skill.skillId, skill: skill.slug });

    try {
      const result = await this.withRetry(
        () => this.withTimeout(this.executeStrategy(step, skill, args, request), skill.timeout),
        skill,
      );
      this.validateOutput(skill, result);
      this.logger.log({ event: 'skill.completed', skillId: skill.skillId, skill: skill.slug });
      return result;
    } catch (error) {
      const normalized = this.normalizeError(error, skill);
      this.logger.error({
        event: 'skill.failed',
        skillId: skill.skillId,
        skill: skill.slug,
        code: normalized.code,
        retryable: normalized.retryable,
      });
      throw normalized;
    }
  }

  private validateManifest(
    skill: SkillManifest | undefined,
    step: PlanStep,
  ): asserts skill is SkillManifest {
    if (!skill) {
      throw new SkillRuntimeError(
        'SKILL_NOT_FOUND',
        `Skill "${step.skillName}" is not available for this agent`,
      );
    }
    if (skill.status !== 'ACTIVE') {
      throw new SkillRuntimeError('SKILL_NOT_ACTIVE', `Skill "${skill.name}" is not active`);
    }
  }

  private async executeStrategy(
    step: PlanStep,
    skill: SkillManifest,
    args: Record<string, unknown>,
    request: SkillRuntimeRequest,
  ): Promise<unknown> {
    const query = this.resolveQuery(args, step, request.userMessage);

    switch (skill.executionMode) {
      case SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL:
        return this.knowledgeService.search({
          userId: request.userId,
          organizationId: request.organizationId,
          query,
          limit: this.toNumber(args.limit, 5),
          offset: 0,
        });
      case SKILL_EXECUTION_MODE.MEMORY_RETRIEVAL:
        return this.memoryService.searchByAgent(request.agentId, query, {
          limit: this.toNumber(args.limit, 10),
        });
      case SKILL_EXECUTION_MODE.N8N_WORKFLOW:
        return this.runN8nWorkflow(skill, args, request);
      case SKILL_EXECUTION_MODE.HUMAN_APPROVAL:
        throw new SkillRuntimeError(
          'APPROVAL_REQUIRED',
          `Skill "${skill.name}" requires human approval and cannot run autonomously`,
        );
      case SKILL_EXECUTION_MODE.HYBRID:
      case SKILL_EXECUTION_MODE.AI_ONLY:
        return this.runAiSkill(skill, step, args, query, request);
      default:
        throw new SkillRuntimeError(
          'EXECUTION_FAILED',
          `Skill "${skill.name}" has unsupported execution mode "${skill.executionMode}"`,
        );
    }
  }

  private async runAiSkill(
    skill: SkillManifest,
    step: PlanStep,
    args: Record<string, unknown>,
    query: string,
    request: SkillRuntimeRequest,
  ): Promise<string> {
    let knowledgeContext = '';
    if (skill.executionMode === SKILL_EXECUTION_MODE.HYBRID) {
      const chunks = await this.knowledgeService.search({
        userId: request.userId,
        organizationId: request.organizationId,
        query,
        limit: 3,
        offset: 0,
      });
      knowledgeContext = chunks.length
        ? `\n\nRelevant knowledge:\n${chunks.map((chunk) => chunk.content).join('\n---\n')}`
        : '\n\n(No relevant knowledge found.)';
    }

    const result = await this.llmRuntime.generateText({
      mode: 'medium',
      systemPrompt: buildSkillSystemPrompt({
        name: skill.name,
        instructions: skill.instructions,
        knowledge: knowledgeContext.trim() || undefined,
      }),
      messages: [
        {
          role: 'user',
          content: `Skill input:\n${this.serialize(args)}\n\nPlan input:\n${this.serialize(step.input)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    });

    return result.content;
  }

  private async runN8nWorkflow(
    skill: SkillManifest,
    args: Record<string, unknown>,
    request: SkillRuntimeRequest,
  ): Promise<unknown> {
    const webhookBase = this.configService.get<string>('N8N_WEBHOOK_URL');
    if (!webhookBase) {
      throw new SkillRuntimeError('DEPENDENCY_MISSING', 'N8N_WEBHOOK_URL is not configured');
    }

    const url = `${webhookBase.replace(/\/+$/, '')}/${skill.slug}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        userId: request.userId,
        organizationId: request.organizationId,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new SkillRuntimeError(
        'EXECUTION_FAILED',
        `n8n workflow returned HTTP ${response.status}`,
        response.status >= 500,
      );
    }
    return (response.headers.get('content-type') ?? '').includes('application/json')
      ? response.json()
      : response.text();
  }

  private async withRetry<T>(operation: () => Promise<T>, skill: SkillManifest): Promise<T> {
    const policy = (skill.retryPolicy ?? {}) as { maxAttempts?: number };
    const maxAttempts = Math.max(1, this.toNumber(policy.maxAttempts, 1));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const normalized = this.normalizeError(error, skill);
        if (!normalized.retryable || attempt === maxAttempts) throw normalized;
      }
    }
    throw this.normalizeError(lastError, skill);
  }

  private async withTimeout<T>(promise: Promise<T>, timeout?: number): Promise<T> {
    const timeoutMs = timeout ?? 60_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new SkillRuntimeError(
              'EXECUTION_TIMEOUT',
              `Skill execution timed out after ${timeoutMs}ms`,
              true,
            ),
          ),
        timeoutMs,
      );
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  private validateInput(skill: SkillManifest, input: Record<string, unknown>): void {
    this.validateJsonSchema(skill.inputSchema, input, 'input');
  }

  private validateOutput(skill: SkillManifest, output: unknown): void {
    this.validateJsonSchema(skill.outputSchema, output, 'output');
  }

  private validateJsonSchema(
    schema: Record<string, unknown> | undefined,
    value: unknown,
    label: string,
  ): void {
    if (!schema) return;
    const code = label === 'input' ? 'INVALID_INPUT' : 'INVALID_OUTPUT';
    if (
      schema.type === 'object' &&
      (value === null || typeof value !== 'object' || Array.isArray(value))
    ) {
      throw new SkillRuntimeError(code, `Invalid skill ${label}: expected an object`);
    }
    if (schema.type === 'array' && !Array.isArray(value)) {
      throw new SkillRuntimeError(code, `Invalid skill ${label}: expected an array`);
    }
    if (schema.type === 'string' && typeof value !== 'string') {
      throw new SkillRuntimeError(code, `Invalid skill ${label}: expected a string`);
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const field of required) {
      if (typeof field === 'string' && (value as Record<string, unknown>)[field] === undefined) {
        throw new SkillRuntimeError(
          code,
          `Invalid skill ${label}: missing required field "${field}"`,
        );
      }
    }
  }

  private normalizeError(error: unknown, skill: SkillManifest): SkillRuntimeError {
    if (error instanceof SkillRuntimeError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      /timeout|timed out|network|rate limit|429|500|502|503|504|temporar|unavailable|fetch/i.test(
        message,
      );
    return new SkillRuntimeError(
      'EXECUTION_FAILED',
      `Skill "${skill.name}" failed: ${message}`,
      retryable,
    );
  }

  private resolveQuery(args: Record<string, unknown>, step: PlanStep, userMessage: string): string {
    const candidate = args.query ?? args.text ?? args.prompt ?? step.input.query ?? step.input.text;
    return typeof candidate === 'string' && candidate.trim() ? candidate : userMessage;
  }

  private serialize(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
