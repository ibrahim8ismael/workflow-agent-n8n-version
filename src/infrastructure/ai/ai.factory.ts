import { AIProvider } from './ai.interface';

export class AIProviderFactory {
  static create(provider: string): AIProvider {
    throw new Error(`Provider ${provider} not implemented`);
  }
}
