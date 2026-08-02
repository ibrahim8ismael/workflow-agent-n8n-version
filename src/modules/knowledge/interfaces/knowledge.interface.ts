export interface IKnowledgeDocument {
  id: string;
  title: string;
  source?: string;
  contentType: string;
  content?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IKnowledgeChunk {
  id: string;
  knowledgeDocumentId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  chunkIndex: number;
}
