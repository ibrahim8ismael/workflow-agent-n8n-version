import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodemailerEmailProvider } from './nodemailer.provider';

describe('NodemailerEmailProvider', () => {
  let provider: NodemailerEmailProvider;

  beforeEach(() => {
    delete process.env.EMAIL_LOGO_URL;
    provider = new NodemailerEmailProvider();
  });

  it('renders the OTP email according to the mail design system', async () => {
    const send = vi.spyOn(provider, 'send').mockResolvedValue({ id: 'message-1', success: true });

    await provider.sendTemplate({
      to: 'person@example.com',
      template: 'otp',
      data: { code: '123456', expiresIn: 5, recipientEmail: 'person@example.com' },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your Woops verification code',
        text: expect.stringContaining('Verification code: 123456'),
      }),
    );

    const params = send.mock.calls[0]?.[0];
    expect(params?.html).toContain('SECURITY');
    expect(params?.html).toContain('Your verification code');
    expect(params?.html).toContain('SIX-DIGIT VERIFICATION CODE');
    expect(params?.html).toContain('This code expires in 5 minutes.');
    expect(params?.html).toContain(
      'If you did not request this code, you can safely ignore this email.',
    );
    expect(params?.html).toContain('src="/logo/logo.svg"');
  });

  it('escapes values interpolated into HTML', async () => {
    const send = vi.spyOn(provider, 'send').mockResolvedValue({ id: 'message-1', success: true });

    await provider.sendTemplate({
      to: 'person@example.com',
      template: 'otp',
      data: { code: '<123456', expiresIn: 5, recipientEmail: 'person&example.com' },
    });

    const html = send.mock.calls[0]?.[0].html ?? '';
    expect(html).toContain('&lt;123456');
    expect(html).toContain('person&amp;example.com');
    expect(html).not.toContain('<123456');
  });
});
