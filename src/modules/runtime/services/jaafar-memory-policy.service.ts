import { Injectable } from '@nestjs/common';

export interface LearningCandidate {
  content: string;
  source: string;
  confidence: number;
  scope: 'user' | 'organization' | 'agent';
  expiresAt?: string;
}

@Injectable()
export class JaafarMemoryPolicyService {
  filter(candidate: LearningCandidate): LearningCandidate | undefined {
    const content = candidate.content.trim();
    if (!content || candidate.confidence < 0.8) return undefined;
    if (/password|secret|token|api[_ -]?key|oauth|credential|authorization/i.test(content)) {
      return undefined;
    }
    return { ...candidate, content };
  }
}
