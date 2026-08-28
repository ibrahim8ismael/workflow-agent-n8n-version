export interface PlanStep {
  skillId: string;
  skillName: string;
  order: number;
  input: Record<string, unknown>;
  required: boolean;
}

export interface MissingInput {
  field: string;
  description: string;
  skillId: string;
}

export interface Plan {
  intent:
    | 'brainstorming'
    | 'automation_design'
    | 'task_execution'
    | 'clarification'
    | 'general_question';
  goal: string;
  reasoning: string;
  steps: PlanStep[];
  missingInputs: MissingInput[];
  successCriteria: string[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
  requiresApproval: boolean;
  approvalReasons: string[];
  unavailableCapabilities: string[];
  confidence: number;
  agentId: string;
  conversationId?: string;
}

export interface PlannerInput {
  userMessage: string;
  agentId: string;
  agentInstructions?: string;
  conversationId?: string;
  organizationId?: string;
  availableSkills: Array<{
    id: string;
    skillId: string;
    name: string;
    description?: string;
    category?: string;
    executionMode: string;
    inputSchema?: Record<string, unknown>;
  }>;
  memory?: Array<{ key: string; content: string; type: string }>;
  knowledge?: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
  effort?: 'low' | 'medium' | 'high';
}
