import type { Plan } from '../../planner/interfaces/plan.interface';

export interface WorkflowNode {
  id: string;
  type: 'skill';
  name: string;
  skillId: string;
  order: number;
  input: Record<string, unknown>;
  required: boolean;
}

export interface WorkflowDefinition {
  version: 1;
  nodes: WorkflowNode[];
  connections: Array<{ from: string; to: string }>;
  conditions: Record<string, unknown>[];
  variables: Record<string, unknown>;
  tools: string[];
  inputs: string[];
  outputs: string[];
  triggers: string[];
  metadata: {
    goal: string;
    successCriteria: string[];
    agentId: string;
  };
}

export function generateWorkflow(plan: Plan): WorkflowDefinition {
  const nodes = [...plan.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => ({
      id: `step-${step.order}`,
      type: 'skill' as const,
      name: step.skillName,
      skillId: step.skillId,
      order: step.order,
      input: step.input,
      required: step.required,
    }));

  return {
    version: 1,
    nodes,
    connections: nodes.slice(1).map((node, index) => ({
      from: nodes[index].id,
      to: node.id,
    })),
    conditions: [],
    variables: {},
    tools: nodes.map((node) => node.skillId),
    inputs: plan.missingInputs.map((input) => input.field),
    outputs: plan.successCriteria,
    triggers: ['user_request'],
    metadata: {
      goal: plan.goal,
      successCriteria: plan.successCriteria,
      agentId: plan.agentId,
    },
  };
}
