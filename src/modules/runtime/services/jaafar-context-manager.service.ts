import { Injectable, Logger } from '@nestjs/common';
import { AutomationsService } from '../../automations/services/automations.service';
import { AgentRunService } from '../../runs/agent-run.service';
import type { ToolDefinition } from '../interfaces/tool.interface';
import { IntegrationRegistryService } from './integration-registry.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';

export type ContextStage = 'UNDERSTANDING' | 'PLANNING' | 'BUILDING' | 'EXECUTING' | 'FAILURE';

export interface ProvidedBusinessProfile {
  name?: string;
  industry?: string;
  description?: string;
  products?: string[];
  channels?: string[];
  rules?: string[];
}

export interface ProvidedPreferences {
  language?: string;
  timezone?: string;
  notes?: string[];
}

export interface StageContextRequest {
  stage: ContextStage;
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  /** V2 run id — FAILURE stage reads its trail through AgentRunService. */
  runId?: string;
  /** Caller-supplied until the Milestone 4 business-profile store lands. */
  businessProfile?: ProvidedBusinessProfile;
  /** Caller-supplied until the Milestone 4 preference store lands. */
  preferences?: ProvidedPreferences;
}

export interface ContextSection {
  title: string;
  body: string;
  truncated: boolean;
  unavailable?: boolean;
}

export interface StageContext {
  stage: ContextStage;
  agentId: string;
  sections: Record<string, ContextSection>;
  totalChars: number;
  truncated: string[];
}

const TOTAL_BUDGET_CHARS = 12_000;

/** Per-section char budgets. Sum exceeds the total on purpose — the manager
 * trims lowest-priority sections first and reports what was cut. */
const SECTION_BUDGETS: Record<string, number> = {
  agent: 800,
  business: 1_200,
  preferences: 500,
  conversation: 4_000,
  integration: 1_500,
  tools: 4_000,
  workflow: 1_500,
  failure: 2_000,
};

/** Truncation priority: lowest importance first. Agent identity is last. */
const TRUNCATION_ORDER = [
  'preferences',
  'workflow',
  'tools',
  'conversation',
  'integration',
  'business',
  'failure',
  'agent',
];

/** Sections trimmed from the front (drop oldest) instead of the end. */
const CUT_OLDEST_FIRST = new Set(['conversation']);

const HISTORY_LIMITS: Record<ContextStage, number> = {
  UNDERSTANDING: 10,
  PLANNING: 10,
  BUILDING: 5,
  EXECUTING: 5,
  FAILURE: 5,
};

/**
 * Context Manager (docs/Jaafar-improve.md §3).
 *
 * Builds stage-specific context on top of JaafarContextLoaderService: each
 * pipeline stage receives only what it needs (business / integration /
 * conversation / workflow / failure / preference sections), within char
 * budgets, with truncation reported. Optional enrichments degrade to
 * `unavailable` sections — context must never break a run.
 */
@Injectable()
export class JaafarContextManagerService {
  private readonly logger = new Logger(JaafarContextManagerService.name);

  constructor(
    private readonly loader: JaafarContextLoaderService,
    private readonly registry: IntegrationRegistryService,
    private readonly automations: AutomationsService,
    private readonly agentRuns: AgentRunService,
  ) {}

  async buildForStage(request: StageContextRequest): Promise<StageContext> {
    const loaded = await this.loader.load({
      agentId: request.agentId,
      userMessage: request.userMessage,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      mode: this.loaderMode(request.stage),
    });

    const sections: Record<string, ContextSection> = {};
    const historyLimit = HISTORY_LIMITS[request.stage];

    sections.agent = this.section('Agent', () =>
      [
        `Name: ${loaded.agent.name}`,
        loaded.agent.description ? `Description: ${loaded.agent.description}` : '',
        loaded.agent.instructions ? `Instructions: ${loaded.agent.instructions}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    if (
      request.stage === 'UNDERSTANDING' ||
      request.stage === 'PLANNING' ||
      request.stage === 'BUILDING'
    ) {
      sections.business = this.section('Business', () => this.renderBusiness(request));
    }

    if (request.preferences) {
      const preferences = request.preferences;
      sections.preferences = this.section('Preferences', () =>
        [
          preferences.language ? `Language: ${preferences.language}` : '',
          preferences.timezone ? `Timezone: ${preferences.timezone}` : '',
          preferences.notes?.length ? `Notes:\n- ${preferences.notes.join('\n- ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    sections.conversation = this.section('Conversation', () =>
      loaded.history
        .slice(-historyLimit)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n'),
    );

    if (request.stage !== 'UNDERSTANDING' && request.stage !== 'FAILURE') {
      sections.integration = await this.safeSection('Integrations', () =>
        this.renderIntegrations(request),
      );
      sections.tools = this.section('Tools', () => this.renderTools(loaded.tools));
    }

    if (request.stage === 'BUILDING') {
      sections.workflow = await this.safeSection('Automations', () =>
        this.renderWorkflows(request),
      );
    }

    if (request.stage === 'FAILURE') {
      sections.integration = await this.safeSection('Integrations', () =>
        this.renderIntegrations(request),
      );
      sections.failure = await this.safeSection('Failure', () => this.renderFailure(request));
    }

    return this.applyBudgets(request.stage, request.agentId, sections);
  }

  /** Renders a built stage context to prompt text (skips empty sections). */
  renderToPromptText(context: StageContext): string {
    const parts: string[] = [];
    for (const [key, section] of Object.entries(context.sections)) {
      if (section.unavailable) {
        parts.push(`## ${section.title}\n(unavailable: ${key} context could not be loaded)`);
      } else if (section.body.trim()) {
        parts.push(`## ${section.title}\n${section.body}`);
      }
    }
    return parts.join('\n\n');
  }

  // ── internals ──────────────────────────────────────────────

  private loaderMode(stage: ContextStage): 'conversation' | 'planning' | 'execution' {
    if (stage === 'EXECUTING' || stage === 'FAILURE') return 'execution';
    if (stage === 'UNDERSTANDING') return 'conversation';
    return 'planning';
  }

  private section(title: string, build: () => string): ContextSection {
    return { title, body: build(), truncated: false };
  }

  private async safeSection(title: string, build: () => Promise<string>): Promise<ContextSection> {
    try {
      return { title, body: await build(), truncated: false };
    } catch (error) {
      this.logger.warn({
        event: 'context.section_unavailable',
        section: title,
        message: error instanceof Error ? error.message : String(error),
      });
      return { title, body: '', truncated: false, unavailable: true };
    }
  }

  private renderBusiness(request: StageContextRequest): string {
    const profile = request.businessProfile;
    if (!profile) return '(no business profile provided yet)';
    const lines = [
      profile.name ? `Business: ${profile.name}` : '',
      profile.industry ? `Industry: ${profile.industry}` : '',
      profile.description ? `Description: ${profile.description}` : '',
      profile.products?.length ? `Products/services: ${profile.products.join(', ')}` : '',
      profile.channels?.length ? `Channels: ${profile.channels.join(', ')}` : '',
      profile.rules?.length ? `Business rules:\n- ${profile.rules.join('\n- ')}` : '',
    ].filter(Boolean);
    return lines.length > 0 ? lines.join('\n') : '(no business profile provided yet)';
  }

  private async renderIntegrations(request: StageContextRequest): Promise<string> {
    const capabilities = await this.registry.capabilitiesForScope({
      ...(request.userId ? { userId: request.userId } : {}),
      ...(request.organizationId ? { organizationId: request.organizationId } : {}),
    });
    if (capabilities.length === 0) return '(no integrations connected)';
    return capabilities
      .map(
        (capability) =>
          `- ${capability.displayName} [${capability.connectionStatus}]` +
          (capability.credentialsAvailable ? ' (credentials available)' : '') +
          (capability.credentialType ? ` <${capability.credentialType}>` : ''),
      )
      .join('\n');
  }

  private renderTools(tools: ToolDefinition[]): string {
    if (tools.length === 0) return '(no tools available)';
    return tools
      .map(
        (tool) =>
          `- ${tool.id}: ${tool.description}` +
          (tool.requiresApproval || tool.sideEffect ? ' [requires approval]' : '') +
          (tool.unavailableReason ? ` [${tool.unavailableReason}]` : ''),
      )
      .join('\n');
  }

  private async renderWorkflows(request: StageContextRequest): Promise<string> {
    const rows = await this.automations.list({
      ...(request.userId ? { userId: request.userId } : {}),
      ...(request.organizationId ? { organizationId: request.organizationId } : {}),
    });
    if (rows.length === 0) return '(no automations yet)';
    return rows
      .slice(0, 20)
      .map(
        (row) => `- ${row.name} [${row.status}]${row.description ? ` — ${row.description}` : ''}`,
      )
      .join('\n');
  }

  private async renderFailure(request: StageContextRequest): Promise<string> {
    if (!request.runId) return '(no run reference for failure analysis)';
    const snapshot = await this.agentRuns.snapshot(request.runId);
    const run = snapshot.run as {
      status: string;
      currentPhase: string;
      error?: string | null;
      repairAttempts?: unknown;
    };
    const repairs = Array.isArray(run.repairAttempts) ? run.repairAttempts.length : 0;
    const trail = snapshot.transitions
      .slice(-5)
      .map(
        (transition) =>
          `- ${transition.fromPhase ?? '?'} → ${transition.toPhase ?? '?'} (${transition.fromStatus ?? '?'} → ${transition.toStatus ?? '?'})${transition.reason ? `: ${transition.reason}` : ''}`,
      )
      .join('\n');
    return [
      `Status: ${run.status}`,
      `Phase: ${run.currentPhase}`,
      run.error ? `Last error: ${run.error}` : '',
      `Repair attempts: ${repairs}`,
      trail ? `Recent transitions:\n${trail}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private applyBudgets(
    stage: ContextStage,
    agentId: string,
    sections: Record<string, ContextSection>,
  ): StageContext {
    const total = () =>
      Object.values(sections).reduce((sum, section) => sum + section.body.length, 0);
    const truncated: string[] = [];
    // Per-section caps first.
    for (const [key, section] of Object.entries(sections)) {
      if (section.unavailable) continue;
      const budget = SECTION_BUDGETS[key] ?? TOTAL_BUDGET_CHARS;
      if (section.body.length > budget) {
        this.cutSection(key, section, section.body.length - budget);
        truncated.push(key);
      }
    }
    // Then the global budget, trimming lowest-priority sections first.
    let over = total() - TOTAL_BUDGET_CHARS;
    if (over > 0) {
      for (const key of TRUNCATION_ORDER) {
        if (over <= 0) break;
        const section = sections[key];
        if (!section || section.unavailable || section.body.length === 0) continue;
        const cut = Math.min(section.body.length, over);
        this.cutSection(key, section, cut);
        if (!truncated.includes(key)) truncated.push(key);
        over -= cut;
      }
    }
    return { stage, agentId, sections, totalChars: total(), truncated };
  }

  private cutSection(key: string, section: ContextSection, chars: number): void {
    if (chars <= 0) return;
    if (chars >= section.body.length) {
      section.body = '';
    } else if (CUT_OLDEST_FIRST.has(key)) {
      section.body = `…(truncated)\n${section.body.slice(chars)}`;
    } else {
      section.body = `${section.body.slice(0, section.body.length - chars)}\n…(truncated)`;
    }
    section.truncated = true;
  }
}
