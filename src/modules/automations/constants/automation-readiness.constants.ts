/**
 * Credential-independent workflow readiness model.
 *
 * The blueprint is STATIC (nodes, integrations, node types, connections).
 * Readiness is DYNAMIC (current credential state) and lives on Automation,
 * never inside the immutable blueprint — connecting a credential must not
 * change `blueprintRevision()`.
 */

export const CREDENTIAL_STATUS = {
  CONFIGURED: 'CONFIGURED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NEEDS_CREDENTIAL: 'NEEDS_CREDENTIAL',
} as const;

export type CredentialStatus = (typeof CREDENTIAL_STATUS)[keyof typeof CREDENTIAL_STATUS];

export interface ReadinessBlocker {
  nodeId: string;
  integration: string;
  credentialStatus: CredentialStatus;
  /** Credential TYPE name only (e.g. `gmailOAuth2`) — never ids/secrets. */
  credentialType?: string;
  /** Human-readable hint, e.g. ambiguous credential matches. */
  detail?: string;
}

export interface WorkflowReadiness {
  buildable: boolean;
  readyToRun: boolean;
  readinessBlockers: ReadinessBlocker[];
}

export function emptyReadiness(): WorkflowReadiness {
  return { buildable: true, readyToRun: true, readinessBlockers: [] };
}

export function blockedReadiness(blockers: ReadinessBlocker[]): WorkflowReadiness {
  return { buildable: true, readyToRun: blockers.length === 0, readinessBlockers: blockers };
}

/** Names of integrations still requiring credentials, deduplicated. */
export function missingIntegrations(blockers: ReadinessBlocker[]): string[] {
  return [...new Set(blockers.map((b) => b.integration))];
}

export function formatMissingCredentials(blockers: ReadinessBlocker[]): string | null {
  const names = missingIntegrations(blockers);
  if (names.length === 0) return null;
  const pretty = (name: string): string =>
    name
      .split(/[_-]+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  if (names.length === 1) return pretty(names[0]!);
  return `${names.slice(0, -1).map(pretty).join(', ')} and ${pretty(names[names.length - 1]!)}`;
}

export function readinessSummary(readiness: WorkflowReadiness): string {
  if (readiness.readyToRun) return 'Workflow is ready to run.';
  const missing = formatMissingCredentials(readiness.readinessBlockers);
  if (!missing) return 'Workflow is built but not ready to run.';
  return `I've built the workflow${readiness.readinessBlockers.length > 1 ? ' successfully' : ''}. ${missing} still need${readiness.readinessBlockers.length === 1 && missingIntegrations(readiness.readinessBlockers).length === 1 ? 's' : ''} to be connected before it can run.`;
}

export function isReadinessBlocker(value: unknown): value is ReadinessBlocker {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.nodeId === 'string' &&
    typeof record.integration === 'string' &&
    (record.credentialStatus === CREDENTIAL_STATUS.CONFIGURED ||
      record.credentialStatus === CREDENTIAL_STATUS.NOT_CONFIGURED ||
      record.credentialStatus === CREDENTIAL_STATUS.NEEDS_CREDENTIAL)
  );
}

export function parseReadinessBlockers(value: unknown): ReadinessBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isReadinessBlocker);
}
