/**
 * Classifies a short chat reply as an approval decision.
 *
 * Used when a conversation has an automation design parked at the approval
 * gate: "ok i approve" must resume the WAITING run instead of starting a
 * fresh design. Anything ambiguous returns 'undecided' and the message keeps
 * flowing through normal LLM classification — the fail-safe direction is
 * always "don't provision on ambiguous text".
 *
 * Heuristic only (EN + AR). Rules, in order:
 *  1. Long messages (> MAX_WORDS) are never decisions — amendments and
 *     questions belong to the classifier.
 *  2. Explicit rejection phrases win over everything ("no thanks" is a no
 *     even though it contains "thanks").
 *  3. Gratitude / contrast / conditional tokens veto a decision — the reply
 *     is reacting to something else ("ok thanks", "yes, but change…").
 *  4. Rejection tokens decide 'reject' ("لا", "cancel", "stop"), as does a
 *     negation governing a build verb ("do not build", "لا تبني").
 *  5. Approval tokens/phrases decide 'approve' unless a negation is also
 *     present ("not approved?", "مش عايز أبدأ") → undecided.
 */
export type ApprovalReplyDecision = 'approve' | 'reject' | 'undecided';

const MAX_WORDS = 12;

/** Collapse elongated characters ("okkk" → "ok", "لاااا" → "لا"). */
function collapseElongation(value: string): string {
  return value.replace(/(.)\1{2,}/g, '$1');
}

function normalize(message: unknown): { tokens: string[]; joined: string } {
  if (typeof message !== 'string') return { tokens: [], joined: '' };
  const cleaned = collapseElongation(
    message
      .toLowerCase()
      // Strip Arabic diacritics + tatweel only — hamzas stay distinct so
      // "ابدأ" (start!) never merges with "ابدا" (never). Apostrophes are
      // removed first ("don't" → "dont") to match the token sets below.
      .replace(/[ً-ٟـ]/g, '')
      .replace(/['’‘`]/g, '')
      // Keep letters/numbers across scripts; split on everything else.
      .replace(/[^\p{L}\p{N}\s]/gu, ' '),
  );
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return { tokens, joined: tokens.join(' ') };
}

/** Phrases checked against the whole joined message (before vetoes). */
const REJECT_PHRASES = [
  'never mind',
  'no thanks',
  'not now',
  'not yet',
  'لا أريد',
  'لا اريد',
  'مش عايز',
  'مش عاوز',
  'مش عايزة',
  'لا تفعل',
  'لا تفعلي',
];

/**
 * Tokens that veto any decision — the reply is conditional, grateful, or an
 * amendment, not a verdict on the pending design.
 */
const VETO_TOKENS = new Set([
  'thanks',
  'thank',
  'thx',
  'شكرا',
  'but',
  'however',
  'although',
  'though',
  'wait',
  'hold',
  'change',
  'instead',
  'edit',
  'modify',
  'yet',
  'first',
  'maybe',
  'else',
  'scratch',
  'قبل',
  'لكن',
  'لو',
  'إذا',
  'اذا',
  'ربما',
  'يمكن',
]);

const REJECT_TOKENS = new Set([
  'no',
  'nope',
  'nah',
  'never',
  'cancel',
  'cancelled',
  'canceled',
  'stop',
  'reject',
  'rejected',
  'decline',
  'declined',
  'dont',
  'لا',
  'لأ',
  'ارفض',
  'أرفض',
  'مرفوض',
  'مرفوضة',
  'الغي',
  'ألغي',
  'الغاء',
  'إلغاء',
  'وقف',
  'بلاش',
]);

const NEGATION_TOKENS = new Set([
  'not',
  "n't",
  'never',
  'dont',
  "don't",
  'without',
  'لم',
  'لن',
  'ما',
  'مش',
  'مو',
  'ليس',
  'ليست',
  'لست',
]);

/** Strong stand-alone verdicts ("ok", "موافق", …). */
const APPROVE_TOKENS = new Set([
  'ok',
  'okay',
  'okie',
  'k',
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'sure',
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'agree',
  'agreed',
  'accept',
  'accepted',
  'نعم',
  'موافق',
  'موافقة',
  'أوافق',
  'اوافق',
  'تمام',
  'اكيد',
  'أكيد',
  'ايوه',
  'ايوة',
  'ممتاز',
  'عظيم',
  'كويس',
  'حلو',
  'جميل',
  'ماشي',
  'اتفقنا',
  'متفق',
  'توكل',
]);

/** Verb-led imperatives that approve a pending design ("build it", "ابدأ"). */
const APPROVE_VERBS = new Set([
  'build',
  'create',
  'start',
  'go',
  'do',
  'make',
  'launch',
  'proceed',
  'deploy',
  'ابني',
  'ابن',
  'اعمل',
  'ابدأ',
  'نفذ',
  'كمل',
  'شغل',
  'انشئ',
]);

const APPROVE_PHRASES = [
  'go ahead',
  'do it',
  'build it',
  'create it',
  'start it',
  'make it',
  'looks good',
  'look good',
  'sounds good',
  'yes please',
  'ok i approve',
  'i approve',
  'looks great',
  'looks perfect',
  'lets go',
  "let's go",
  'توكل على الله',
  'على بركة الله',
];

/** Second-person verbs for the negation+verb refusal rule ("لا تبني"). */
const REFUSABLE_AR_VERBS = new Set([
  'تبني',
  'تبنى',
  'تعمل',
  'تنفذ',
  'تبدأ',
  'تبدا',
  'تشغل',
  'تنشئ',
  'تكمل',
]);

/** "do not build" / "لا تبني" — a negation governing a build verb refuses. */
function isNegatedVerbRefusal(tokens: string[]): boolean {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!NEGATION_TOKENS.has(tokens[index]!)) continue;
    const next = tokens[index + 1]!;
    if (APPROVE_VERBS.has(next) || REFUSABLE_AR_VERBS.has(next)) return true;
  }
  return false;
}

export function classifyApprovalReply(message: unknown): ApprovalReplyDecision {
  const { tokens, joined } = normalize(message);
  if (tokens.length === 0 || tokens.length > MAX_WORDS) return 'undecided';

  for (const phrase of REJECT_PHRASES) {
    if (joined.includes(phrase)) return 'reject';
  }
  if (tokens.some((token) => VETO_TOKENS.has(token))) return 'undecided';
  if (tokens.some((token) => REJECT_TOKENS.has(token))) return 'reject';
  if (isNegatedVerbRefusal(tokens)) return 'reject';

  const approves =
    tokens.some((token) => APPROVE_TOKENS.has(token) || APPROVE_VERBS.has(token)) ||
    APPROVE_PHRASES.some((phrase) => joined.includes(phrase));
  if (!approves) return 'undecided';
  if (tokens.some((token) => NEGATION_TOKENS.has(token))) return 'undecided';
  return 'approve';
}
