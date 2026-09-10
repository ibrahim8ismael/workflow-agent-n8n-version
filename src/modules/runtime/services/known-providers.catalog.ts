/**
 * Known-provider catalog for credential-independent workflow building.
 *
 * Distinguishes:
 * - known provider + missing credential → NEEDS_CREDENTIAL (valid build)
 * - unknown / hallucinated provider   → UNKNOWN_INTEGRATION (reject)
 *
 * Credential availability must NEVER prove provider existence. This catalog
 * is the existence authority, independent of the capability registry.
 */

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Canonical provider keys + well-known aliases. Keys use the same
 * normalization as the integration registry (`slack`, `google_sheets`).
 * Aliases cover display names, node suffixes, and credential-type roots.
 */
const KNOWN_PROVIDERS: Record<
  string,
  { credentialTypes?: string[]; nodeSuffixes?: string[]; nativeNodeTypes?: string[] }
> = {
  slack: {
    credentialTypes: ['slackOAuth2Api', 'slackApi'],
    nativeNodeTypes: ['n8n-nodes-base.slack', 'n8n-nodes-base.slackTrigger'],
  },
  gmail: {
    credentialTypes: ['gmailOAuth2'],
    nativeNodeTypes: ['n8n-nodes-base.gmail', 'n8n-nodes-base.gmailTrigger'],
  },
  google_sheets: {
    credentialTypes: ['googleSheetsOAuth2Api', 'googleSheetsTriggerOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.googleSheetsTrigger'],
  },
  google_drive: {
    credentialTypes: ['googleDriveOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.googleDrive'],
  },
  google_calendar: {
    credentialTypes: ['googleCalendarOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.googleCalendar', 'n8n-nodes-base.googleCalendarTrigger'],
  },
  telegram: {
    credentialTypes: ['telegramApi'],
    nativeNodeTypes: ['n8n-nodes-base.telegram', 'n8n-nodes-base.telegramTrigger'],
  },
  whatsapp: {
    credentialTypes: ['whatsAppCloudApi', 'whatsAppTriggerApi'],
    nativeNodeTypes: [
      'n8n-nodes-base.whatsApp',
      'n8n-nodes-base.whatsAppTrigger',
      '@n8n/n8n-nodes-langchain.whatsAppTrigger',
    ],
  },
  discord: {
    credentialTypes: ['discordWebhookApi'],
    nativeNodeTypes: ['n8n-nodes-base.discord'],
  },
  hubspot: {
    credentialTypes: ['hubspotOAuth2Api', 'hubSpotOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.hubSpot', 'n8n-nodes-base.hubSpotTrigger'],
  },
  salesforce: {
    credentialTypes: ['salesforceOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.salesforce', 'n8n-nodes-base.salesforceTrigger'],
  },
  zoho: {
    credentialTypes: ['zohoOAuth2Api', 'zohoCrmOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.zohoCrm'],
  },
  pipedrive: {
    credentialTypes: ['pipedriveApi'],
    nativeNodeTypes: ['n8n-nodes-base.pipedrive', 'n8n-nodes-base.pipedriveTrigger'],
  },
  shopify: {
    credentialTypes: ['shopifyApi'],
    nativeNodeTypes: ['n8n-nodes-base.shopify', 'n8n-nodes-base.shopifyTrigger'],
  },
  stripe: {
    credentialTypes: ['stripeApi'],
    nativeNodeTypes: ['n8n-nodes-base.stripe', 'n8n-nodes-base.stripeTrigger'],
  },
  notion: {
    credentialTypes: ['notionApi'],
    nativeNodeTypes: ['n8n-nodes-base.notion', 'n8n-nodes-base.notionTrigger'],
  },
  airtable: {
    credentialTypes: ['airtableApi'],
    nativeNodeTypes: ['n8n-nodes-base.airtable', 'n8n-nodes-base.airtableTrigger'],
  },
  openai: {
    credentialTypes: ['openAiApi'],
    nativeNodeTypes: ['@n8n/n8n-nodes-langchain.openAi'],
  },
  postgres: {
    credentialTypes: ['postgres'],
    nativeNodeTypes: ['n8n-nodes-base.postgres'],
  },
  mysql: { credentialTypes: ['mySql'], nativeNodeTypes: ['n8n-nodes-base.mySql'] },
  mongodb: { credentialTypes: ['mongoDb'], nativeNodeTypes: ['n8n-nodes-base.mongoDb'] },
  redis: { credentialTypes: ['redis'], nativeNodeTypes: ['n8n-nodes-base.redis'] },
  smtp: { credentialTypes: ['smtp'], nativeNodeTypes: ['n8n-nodes-base.emailSend'] },
  imap: {
    credentialTypes: ['imap'],
    nativeNodeTypes: ['n8n-nodes-base.emailReadImap'],
  },
  ftp: { credentialTypes: ['ftp'], nativeNodeTypes: ['n8n-nodes-base.ftp'] },
  sftp: { credentialTypes: ['sftp'], nativeNodeTypes: ['n8n-nodes-base.sftp'] },
  github: {
    credentialTypes: ['githubOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.github', 'n8n-nodes-base.githubTrigger'],
  },
  gitlab: {
    credentialTypes: ['gitlabOAuth2Api'],
    nativeNodeTypes: ['n8n-nodes-base.gitlab', 'n8n-nodes-base.gitlabTrigger'],
  },
  jira: { credentialTypes: ['jiraOAuth2Api'], nativeNodeTypes: ['n8n-nodes-base.jira'] },
  trello: {
    credentialTypes: ['trelloApi'],
    nativeNodeTypes: ['n8n-nodes-base.trello', 'n8n-nodes-base.trelloTrigger'],
  },
  asana: { credentialTypes: ['asanaOAuth2Api'], nativeNodeTypes: ['n8n-nodes-base.asana'] },
  mailchimp: {
    credentialTypes: ['mailchimpApi'],
    nativeNodeTypes: ['n8n-nodes-base.mailchimp', 'n8n-nodes-base.mailchimpTrigger'],
  },
  sendgrid: { credentialTypes: ['sendGridApi'], nativeNodeTypes: ['n8n-nodes-base.sendGrid'] },
  twilio: { credentialTypes: ['twilioApi'], nativeNodeTypes: ['n8n-nodes-base.twilio'] },
  zoom: { credentialTypes: ['zoomOAuth2Api'], nativeNodeTypes: [] },
  teams: { credentialTypes: ['microsoftTeamsOAuth2Api'], nativeNodeTypes: [] },
  outlook: { credentialTypes: ['microsoftOutlookOAuth2Api'], nativeNodeTypes: [] },
  excel: { credentialTypes: ['microsoftExcelOAuth2Api'], nativeNodeTypes: [] },
  dropbox: { credentialTypes: ['dropboxOAuth2Api'], nativeNodeTypes: ['n8n-nodes-base.dropbox'] },
  box: { credentialTypes: ['boxOAuth2Api'], nativeNodeTypes: ['n8n-nodes-base.box'] },
  quickbooks: { credentialTypes: ['quickbooksOAuth2Api'], nativeNodeTypes: [] },
  xero: { credentialTypes: ['xeroOAuth2Api'], nativeNodeTypes: [] },
  zendesk: { credentialTypes: ['zendeskApi'], nativeNodeTypes: [] },
  intercom: { credentialTypes: ['intercomApi'], nativeNodeTypes: [] },
  calendly: {
    credentialTypes: ['calendlyApi'],
    nativeNodeTypes: ['n8n-nodes-base.calendlyTrigger'],
  },
  typeform: {
    credentialTypes: ['typeformApi'],
    nativeNodeTypes: ['n8n-nodes-base.typeformTrigger'],
  },
  webhook: {},
  schedule: {},
  manual: {},
  datatable: {},
  http: {},
  code: {},
};

/** Alias → canonical key (normalized on both sides). */
const ALIASES: Record<string, string> = {
  googlesheets: 'google_sheets',
  googledrive: 'google_drive',
  googlecalendar: 'google_calendar',
  whatsappcloud: 'whatsapp',
  hubspotcrm: 'hubspot',
  zohocrm: 'zoho',
  msteams: 'teams',
  microsoftteams: 'teams',
  gsheet: 'google_sheets',
  sheets: 'google_sheets',
};

const NORMALIZED_KNOWN = new Map<string, string>();
for (const key of Object.keys(KNOWN_PROVIDERS)) {
  NORMALIZED_KNOWN.set(normalize(key), key);
  NORMALIZED_KNOWN.set(key, key);
}
for (const [alias, canonical] of Object.entries(ALIASES)) {
  NORMALIZED_KNOWN.set(normalize(alias), canonical);
}

/** Canonical provider key, or null when the name is not a known provider. */
export function canonicalProvider(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return NORMALIZED_KNOWN.get(normalize(trimmed)) ?? null;
}

export function isKnownProvider(name: string): boolean {
  return canonicalProvider(name) !== null;
}

/** Expected n8n credential TYPE names for a provider (type names only). */
export function expectedCredentialTypes(provider: string): string[] {
  const canonical = canonicalProvider(provider);
  if (!canonical) return [];
  return KNOWN_PROVIDERS[canonical]?.credentialTypes ?? [];
}

/** All known canonical provider keys (for diagnostics/tests). */
export function knownProviderKeys(): string[] {
  return Object.keys(KNOWN_PROVIDERS);
}

/** Explicit native n8n node types for a provider (may be empty). */
export function knownNativeNodeTypes(provider: string): string[] {
  const canonical = canonicalProvider(provider);
  if (!canonical) return [];
  return KNOWN_PROVIDERS[canonical]?.nativeNodeTypes ?? [];
}

/**
 * True when `nodeType` is a plausible native node for `provider`.
 *
 * - explicit allowlist match, OR
 * - node suffix equals the provider (slack → n8n-nodes-base.slack), OR
 * - node suffix starts with the provider (gmail → gmailTrigger).
 *
 * This is intentionally conservative: it never proves the node exists in the
 * connected instance — it only prevents a missing inventory observation
 * (common when credentials were never connected) from being misclassified
 * as a hallucinated node. n8n remains the final authority at createWorkflow().
 */
export function isKnownNativeNodeForProvider(provider: string, nodeType: string): boolean {
  const canonical = canonicalProvider(provider);
  if (!canonical || !nodeType || typeof nodeType !== 'string') return false;
  const explicit = KNOWN_PROVIDERS[canonical]?.nativeNodeTypes ?? [];
  if (explicit.includes(nodeType)) return true;
  const dot = nodeType.lastIndexOf('.');
  const suffix = normalize(dot >= 0 ? nodeType.slice(dot + 1) : nodeType);
  const providerNorm = normalize(canonical);
  if (!suffix || !providerNorm) return false;
  return suffix === providerNorm || suffix.startsWith(providerNorm);
}
