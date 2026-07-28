export interface GenerateTextParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface GenerateTextResult {
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelInfo {
  name: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsFunctions: boolean;
}

export interface AIProvider {
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
  generateStream(params: GenerateTextParams): AsyncIterable<GenerateTextResult>;
  generateEmbeddings(text: string): Promise<number[]>;
  countTokens(text: string): Promise<number>;
  getModelInfo(): ModelInfo;
}
