import { Injectable } from '@nestjs/common';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallResult {
  success: boolean;
  output: unknown;
  error?: string;
}

export type ToolExecutor = (args: Record<string, unknown>) => Promise<ToolCallResult>;

@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, { definition: ToolDefinition; execute: ToolExecutor }>();

  register(name: string, definition: ToolDefinition, execute: ToolExecutor): void {
    this.tools.set(name, { definition, execute });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: null, error: `Tool "${name}" not found` };
    }
    try {
      return await tool.execute(args);
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  remove(name: string): void {
    this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}
