import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdapterGenerateObjectParams,
  AdapterGenerateParams,
} from '../ai-adapter/ai-adapter.interface';
import { AIAdapterService } from '../ai-adapter/ai-adapter.service';
import type {
  ExecutionMode,
  ILLMRuntime,
  LLMExecutionMetadata,
  LLMGenerateObjectParams,
  LLMGenerateObjectResult,
  LLMGenerateParams,
  LLMGenerateResult,
  LLMStreamChunk,
  LLMStreamParams,
} from './interfaces/llm-runtime.interface';

interface ModelCandidate {
  provider: string;
  model: string;
  inputCost: number;
  outputCost: number;
}

const DEFAULT_MODELS: Record<ExecutionMode, ModelCandidate> = {
  low: { provider: 'openai', model: 'gpt-4o-mini', inputCost: 0.5, outputCost: 1.5 },
  medium: { provider: 'openai', model: 'gpt-4o', inputCost: 2.5, outputCost: 10 },
  high: { provider: 'openai', model: 'gpt-4o', inputCost: 2.5, outputCost: 10 },
};

@Injectable()
export class LLMRuntimeService implements ILLMRuntime {
  private readonly logger = new Logger(LLMRuntimeService.name);

  constructor(
    private readonly aiAdapter: AIAdapterService,
    private readonly config: ConfigService,
  ) {}

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const startedAt = Date.now();
    const result = await this.withFailover<LLMGenerateResult>(
      params.mode,
      async (candidate) => {
        const adapterParams: AdapterGenerateParams = {
          model: this.modelString(candidate),
          systemPrompt: params.systemPrompt,
          messages: params.messages,
          sdkTools: params.sdkTools,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        };
        const response = await this.withTimeout(
          this.aiAdapter.generateText(adapterParams),
          params.timeoutMs ?? this.timeoutFor(params.mode),
        );
        return {
          ...response,
          execution: this.executionMetadata(params.mode, candidate, startedAt, 0, response.usage),
        };
      },
      params.maxRetries,
      startedAt,
    );

    return result;
  }

  async generateObject(params: LLMGenerateObjectParams): Promise<LLMGenerateObjectResult> {
    const startedAt = Date.now();
    return this.withFailover<LLMGenerateObjectResult>(
      params.mode,
      async (candidate) => {
        const adapterParams: AdapterGenerateObjectParams = {
          model: this.modelString(candidate),
          systemPrompt: params.systemPrompt,
          messages: params.messages,
          schema: params.schema,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        };
        const response = await this.withTimeout(
          this.aiAdapter.generateObject(adapterParams),
          params.timeoutMs ?? this.timeoutFor(params.mode),
        );
        return {
          ...response,
          execution: this.executionMetadata(params.mode, candidate, startedAt, 0, response.usage),
        };
      },
      params.maxRetries,
      startedAt,
    );
  }

  async *generateStream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk> {
    const interChunkTimeout = params.timeoutMs ?? this.timeoutFor(params.mode);
    const firstByteTimeout =
      params.firstByteTimeoutMs ?? params.timeoutMs ?? this.timeoutFor(params.mode);
    const startedAt = Date.now();
    let lastError: unknown;

    for (const candidate of this.resolveCandidates(params.mode)) {
      const execution = this.executionMetadata(params.mode, candidate, startedAt, 0, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
      const stream = this.aiAdapter.generateStream({
        model: this.modelString(candidate),
        systemPrompt: params.systemPrompt,
        messages: params.messages,
        sdkTools: params.sdkTools,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });

      let yielded = false;
      try {
        const iterator = stream[Symbol.asyncIterator]();
        let isFirstChunk = true;
        while (true) {
          const timeoutMs = isFirstChunk ? firstByteTimeout : interChunkTimeout;
          const next = await this.withTimeout(iterator.next(), timeoutMs);
          isFirstChunk = false;
          if (next.done) break;
          const chunk = next.value;
          const normalized: LLMStreamChunk = { ...chunk };
          if (chunk.type === 'finish') {
            execution.durationMs = Date.now() - startedAt;
            normalized.execution = execution;
          }
          yield normalized;
          yielded = true;
        }
        return;
      } catch (error) {
        this.logger.warn(`LLM stream failed for ${candidate.provider}:${candidate.model}`);
        lastError = error;
        if (this.isFatal(error)) throw error;
        // Once tokens reached the caller the run already started rendering —
        // a different provider would produce inconsistent output.
        if (yielded) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('LLM stream failed');
  }

  private async withFailover<T>(
    mode: ExecutionMode,
    execute: (candidate: ModelCandidate) => Promise<T>,
    maxRetries?: number,
    startedAt = Date.now(),
  ): Promise<T> {
    const candidates = this.resolveCandidates(mode);
    const retries = maxRetries ?? this.config.get<number>('LLM_MAX_RETRIES', 1);
    let lastError: unknown;
    let attempts = 0;

    for (const candidate of candidates) {
      for (let retry = 0; retry <= retries; retry++) {
        attempts++;
        try {
          const result = await execute(candidate);
          if (result && typeof result === 'object' && 'execution' in result) {
            const execution = (result as { execution: LLMExecutionMetadata }).execution;
            execution.retries = attempts - 1;
            execution.durationMs = Date.now() - startedAt;
          }
          return result;
        } catch (error) {
          lastError = error;
          if (this.isFatal(error)) throw error;
          if (retry < retries && this.isRetryable(error)) {
            await this.delay(this.retryDelay(retry));
            continue;
          }
          // Transient failures retry the same candidate; any other failure
          // (provider/model-specific, e.g. unsupported structured output)
          // moves on to the next fallback candidate.
          this.logger.warn(`LLM provider failed: ${candidate.provider}:${candidate.model}`);
          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('LLM execution failed');
  }

  /** Auth-level failures are the same across candidates of a provider key. */
  private isFatal(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return /(authentication|unauthorized|forbidden|permission)/.test(message);
  }

  private resolveCandidates(mode: ExecutionMode): ModelCandidate[] {
    const defaults = DEFAULT_MODELS[mode];
    const provider =
      this.config.get<string>(`LLM_${mode.toUpperCase()}_PROVIDER`) ?? defaults.provider;
    const model = this.config.get<string>(`LLM_${mode.toUpperCase()}_MODEL`) ?? defaults.model;
    const fallbackConfig = this.config.get<string>(`LLM_${mode.toUpperCase()}_FALLBACKS`) ?? '';
    const candidates = [{ ...defaults, provider, model }];

    for (const fallback of fallbackConfig
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)) {
      const separator = fallback.indexOf(':');
      if (separator <= 0) continue;
      const fallbackProvider = fallback.slice(0, separator);
      const fallbackModel = fallback.slice(separator + 1);
      candidates.push({
        provider: fallbackProvider,
        model: fallbackModel,
        inputCost: defaults.inputCost,
        outputCost: defaults.outputCost,
      });
    }

    return candidates;
  }

  private modelString(candidate: ModelCandidate): string {
    const prefix = `${candidate.provider}:`;
    return candidate.model.startsWith(prefix) ? candidate.model : `${prefix}${candidate.model}`;
  }

  private executionMetadata(
    mode: ExecutionMode,
    candidate: ModelCandidate,
    _startedAt: number,
    retries: number,
    usage: { promptTokens: number; completionTokens: number; totalTokens?: number },
  ): LLMExecutionMetadata {
    return {
      executionId: randomUUID(),
      mode,
      provider: candidate.provider,
      model: candidate.model,
      durationMs: 0,
      retries,
      estimatedCost: Number(
        (
          (usage.promptTokens * candidate.inputCost +
            usage.completionTokens * candidate.outputCost) /
          1000
        ).toFixed(6),
      ),
    };
  }

  private timeoutFor(mode: ExecutionMode): number {
    return this.config.get<number>(
      `LLM_${mode.toUpperCase()}_TIMEOUT_MS`,
      mode === 'high' ? 120_000 : 60_000,
    );
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`LLM execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  private isRetryable(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      !/(authentication|unauthorized|forbidden|invalid|validation|permission|schema)/.test(
        message,
      ) &&
      /(timeout|timed out|network|rate limit|429|500|502|503|504|temporar|unavailable|fetch|no object generated|unexpected end of json|did not return a response)/.test(
        message,
      )
    );
  }

  private retryDelay(retry: number): number {
    return [250, 500, 1000][retry] ?? 1000;
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
