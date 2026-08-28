/**
 * Protected prompt builders used by the Woops AI runtime.
 *
 * Prompt contracts are split by responsibility under ./modules. This file
 * remains the stable import surface for runtime callers.
 */

export {
  AUTOMATION_BLUEPRINT_SYSTEM_PROMPT,
  JAAFAR_IDENTITY_SYSTEM_PROMPT,
} from './modules/jaafar.prompt';
export {
  PLATFORM_SYSTEM_PROMPT,
  TOOL_USE_POLICY_SYSTEM_PROMPT,
} from './modules/platform.prompt';
export {
  CONVERSATION_RESPONDER_SYSTEM_PROMPT,
  FINAL_RESPONSE_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  RUNTIME_SYSTEM_PROMPT,
  SKILL_SYSTEM_PROMPT,
} from './modules/runtime.prompt';

import { JAAFAR_IDENTITY_SYSTEM_PROMPT } from './modules/jaafar.prompt';
import { PLATFORM_SYSTEM_PROMPT, TOOL_USE_POLICY_SYSTEM_PROMPT } from './modules/platform.prompt';
import {
  CONVERSATION_RESPONDER_SYSTEM_PROMPT,
  FINAL_RESPONSE_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  RUNTIME_SYSTEM_PROMPT,
  SKILL_SYSTEM_PROMPT,
} from './modules/runtime.prompt';

export interface PlannerPromptContext {
  availableSkills: string;
  memory?: string;
  agentInstructions?: string;
  currentTime?: string;
}

export interface PlannerUserPromptContext {
  userMessage: string;
  knowledge?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface RuntimePromptContext {
  agentInstructions?: string;
  plan?: string;
  currentTime?: string;
}

export interface ConversationPromptContext {
  agentInstructions?: string;
  currentTime?: string;
}

export interface SkillPromptContext {
  name: string;
  instructions?: string;
  knowledge?: string;
  currentTime?: string;
}

export interface EmployeePromptContext {
  name: string;
  description: string;
  instructions: string;
  role?: string;
  department?: string;
  memoryPolicy?: string;
  plan?: string;
}

export function buildCurrentTimeContext(timeZone = process.env.BUSINESS_TIMEZONE ?? 'UTC'): string {
  const now = new Date();
  let localTime = now.toISOString();
  try {
    localTime = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(now);
  } catch {
    timeZone = 'UTC';
  }

  return `Current UTC time: ${now.toISOString()}\nBusiness timezone: ${timeZone}\nBusiness local time: ${localTime}`;
}

export function buildPlannerSystemPrompt(context: PlannerPromptContext): string {
  return [
    PLATFORM_SYSTEM_PROMPT,
    JAAFAR_IDENTITY_SYSTEM_PROMPT,
    TOOL_USE_POLICY_SYSTEM_PROMPT,
    PLANNER_SYSTEM_PROMPT,
    `<time_context>\n${context.currentTime ?? buildCurrentTimeContext()}\n</time_context>`,
    `<available_capabilities>\n${context.availableSkills || 'No capabilities are configured yet.'}\n</available_capabilities>`,
    context.memory ? `<employee_memory>\n${context.memory}\n</employee_memory>` : '',
    context.agentInstructions
      ? `<employee_policies>\n${context.agentInstructions}\n</employee_policies>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPlannerUserPrompt(context: PlannerUserPromptContext): string {
  const knowledge = context.knowledge
    ? `<relevant_knowledge>\n${context.knowledge}\n</relevant_knowledge>`
    : '';
  const history = context.conversationHistory?.length
    ? `<conversation_history>\n${context.conversationHistory
        .slice(-12)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')}\n</conversation_history>`
    : '';

  return [
    knowledge,
    history,
    `<current_user_message>\n${context.userMessage}\n</current_user_message>`,
    'Continue helpfully. If the user is designing an automation, gather missing business requirements before proposing execution steps.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildRuntimeSystemPrompt(context: RuntimePromptContext): string {
  return [
    PLATFORM_SYSTEM_PROMPT,
    TOOL_USE_POLICY_SYSTEM_PROMPT,
    RUNTIME_SYSTEM_PROMPT,
    FINAL_RESPONSE_SYSTEM_PROMPT,
    `<time_context>\n${context.currentTime ?? buildCurrentTimeContext()}\n</time_context>`,
    context.agentInstructions
      ? `<employee_policies>\n${context.agentInstructions}\n</employee_policies>`
      : '',
    context.plan ? `<approved_work_plan>\n${context.plan}\n</approved_work_plan>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildConversationSystemPrompt(context: ConversationPromptContext = {}): string {
  return [
    PLATFORM_SYSTEM_PROMPT,
    JAAFAR_IDENTITY_SYSTEM_PROMPT,
    TOOL_USE_POLICY_SYSTEM_PROMPT,
    CONVERSATION_RESPONDER_SYSTEM_PROMPT,
    FINAL_RESPONSE_SYSTEM_PROMPT,
    `<time_context>\n${context.currentTime ?? buildCurrentTimeContext()}\n</time_context>`,
    context.agentInstructions
      ? `<employee_policies>\n${context.agentInstructions}\n</employee_policies>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildEmployeeSystemPrompt(context: EmployeePromptContext): string {
  return [
    PLATFORM_SYSTEM_PROMPT,
    TOOL_USE_POLICY_SYSTEM_PROMPT,
    RUNTIME_SYSTEM_PROMPT,
    FINAL_RESPONSE_SYSTEM_PROMPT,
    `<employee_identity>\nName: ${context.name}\nDescription: ${context.description}\nRole: ${context.role ?? 'Business employee'}\nDepartment: ${context.department ?? 'General'}\n</employee_identity>`,
    `<employee_instructions>\n${context.instructions}\n</employee_instructions>`,
    context.memoryPolicy
      ? `<employee_memory_policy>\n${context.memoryPolicy}\n</employee_memory_policy>`
      : '',
    context.plan ? `<approved_work_plan>\n${context.plan}\n</approved_work_plan>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSkillSystemPrompt(context: SkillPromptContext): string {
  return [
    PLATFORM_SYSTEM_PROMPT,
    TOOL_USE_POLICY_SYSTEM_PROMPT,
    SKILL_SYSTEM_PROMPT,
    `<time_context>\n${context.currentTime ?? buildCurrentTimeContext()}\n</time_context>`,
    `<skill_contract name="${context.name}">\n${context.instructions ?? `Capability: ${context.name}`}\n</skill_contract>`,
    context.knowledge ? `<reference_knowledge>\n${context.knowledge}\n</reference_knowledge>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
