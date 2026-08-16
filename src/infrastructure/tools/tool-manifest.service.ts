import { Injectable } from '@nestjs/common';
import { type ToolManifest, type ToolMode, toolManifestListSchema } from './tool-manifest.types';
import rawTools from './tools.json';

@Injectable()
export class ToolManifestService {
  private readonly tools: ToolManifest[] = toolManifestListSchema.parse(rawTools);

  list(options?: { mode?: ToolMode; includeUnimplemented?: boolean }): ToolManifest[] {
    return this.tools.filter((tool) => {
      if (!options?.includeUnimplemented && !tool.woops.implemented) return false;
      if (options?.mode && !tool.woops.availableIn.includes(options.mode)) return false;
      return true;
    });
  }

  find(name: string): ToolManifest | undefined {
    return this.tools.find((tool) => tool.function.name === name);
  }

  require(name: string): ToolManifest {
    const tool = this.find(name);
    if (!tool) throw new Error(`Tool "${name}" is not configured`);
    return tool;
  }
}
