import { describe, expect, it } from 'vitest';
import { classifyApprovalReply } from './approval-reply';

describe('classifyApprovalReply', () => {
  it.each([
    'ok',
    'OK',
    'ok i approve',
    'ok start build the workflow',
    'ok build the workflow in n8n',
    'yes',
    'Yes please',
    'approve',
    'approved',
    'confirm',
    'go ahead',
    'do it',
    'build it',
    'looks good',
    'looks great',
    'okkk',
    'yesss',
  ])('approves %j', (message) => {
    expect(classifyApprovalReply(message)).toBe('approve');
  });

  it.each(['موافق', 'نعم', 'تمام', 'ابدأ', 'نفذ', 'توكل على الله', 'لاااا'])(
    'approves/rejects Arabic %j',
    (message) => {
      // "لاااا" elongates to "لا" → reject; the rest approve.
      expect(classifyApprovalReply(message)).toBe(message === 'لاااا' ? 'reject' : 'approve');
    },
  );

  it.each([
    'no',
    'nope',
    'reject',
    'cancel',
    'stop',
    'never mind',
    'no thanks',
    'do not build',
    "don't approve this",
    'لا',
    'ارفض',
    'الغي',
    'مش عايز',
  ])('rejects %j', (message) => {
    expect(classifyApprovalReply(message)).toBe('reject');
  });

  it.each([
    '',
    'ok thanks!',
    'thanks, looks good',
    'yes, but change the channel to #sales',
    'ok, wait — which Slack workspace?',
    'do not build it yet',
    'مش موافق على كده',
    'how much will this cost?',
    'When a new order arrives via webhook, send a Slack message to the #orders channel',
    'actually build me something else entirely from scratch today please sir',
  ])('leaves %j undecided', (message) => {
    expect(classifyApprovalReply(message)).toBe('undecided');
  });

  it('leaves non-string input undecided', () => {
    expect(classifyApprovalReply(undefined)).toBe('undecided');
    expect(classifyApprovalReply(null)).toBe('undecided');
    expect(classifyApprovalReply(42)).toBe('undecided');
  });
});
