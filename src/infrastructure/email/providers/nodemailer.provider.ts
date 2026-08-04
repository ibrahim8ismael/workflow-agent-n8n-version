import { Injectable } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import type {
  EmailProvider,
  SendEmailParams,
  SendEmailResult,
  SendTemplateParams,
} from '../email.interface';

@Injectable()
export class NodemailerEmailProvider implements EmailProvider {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
    });
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const from = params.from ?? process.env.SMTP_FROM ?? 'noreply@woops.com';

    const info = await this.transporter.sendMail({
      from,
      to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    return { id: info.messageId, success: true };
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendEmailResult> {
    const rendered = this.renderTemplate(params.template, params.data);
    return this.send({
      to: params.to,
      subject: this.templateSubject(params.template),
      html: rendered.html,
      text: rendered.text,
      from: params.from,
    });
  }

  async verifyAddress(_email: string): Promise<boolean> {
    return true;
  }

  private renderTemplate(
    template: string,
    data: Record<string, unknown>,
  ): { html: string; text: string } {
    const templates: Record<
      string,
      (d: Record<string, unknown>) => { html: string; text: string }
    > = {
      otp: (d) => {
        const code = this.escapeHtml(String(d.code ?? ''));
        const expiresIn = this.escapeHtml(String(d.expiresIn ?? '5'));
        const recipientEmail = this.escapeHtml(String(d.recipientEmail ?? ''));
        const logoUrl = this.escapeHtml(process.env.EMAIL_LOGO_URL ?? '/logo/logo.svg');
        const plainCode = String(d.code ?? '');
        const plainExpiresIn = String(d.expiresIn ?? '5');
        const plainRecipientEmail = String(d.recipientEmail ?? '');
        const recipientContext = recipientEmail
          ? `<p style="margin: 0; color: #475569; font-size: 14px; line-height: 1.5;">We received a sign-in request for <strong>${recipientEmail}</strong>.</p>`
          : '';
        const plainRecipientContext = plainRecipientEmail
          ? `We received a sign-in request for ${plainRecipientEmail}.\n\n`
          : '';

        return {
          html: `
<!doctype html>
<html lang="en">
  <head>
    <meta name="x-apple-disable-message-reformatting">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Woops verification code</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Helvetica, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">Use this six-digit verification code to sign in to Woops.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background: #f8fafc;">
      <tr>
        <td align="center" style="padding: 32px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background: #ffffff; border: 1px solid #e5e7eb;">
            <tr>
              <td style="padding: 28px 24px 22px; border-bottom: 1px solid #e5e7eb;">
                <img src="${logoUrl}" width="76" alt="Woops" style="display: block; width: 76px; height: auto; border: 0;">
                <div style="margin-top: 8px; color: #2132d0; font-size: 18px; font-weight: 700; line-height: 1;">Woops</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 24px 36px;">
                <p style="margin: 0 0 12px; color: #2563eb; font-size: 12px; font-weight: 700; letter-spacing: 1px; line-height: 1.5;">SECURITY</p>
                <h1 style="margin: 0 0 14px; color: #0f172a; font-size: 28px; line-height: 1.25;">Your verification code</h1>
                <p style="margin: 0 0 12px; color: #475569; font-size: 16px; line-height: 1.5;">Use the code below to sign in to Woops.</p>
                ${recipientContext}
                <div style="margin: 28px 0 0; padding: 24px 16px 18px; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; text-align: center;">
                  <div style="color: #475569; font-size: 12px; font-weight: 700; letter-spacing: 1px; line-height: 1.5;">SIX-DIGIT VERIFICATION CODE</div>
                  <div style="margin-top: 8px; color: #0f172a; font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; line-height: 1.25;">${code}</div>
                  <div style="margin-top: 12px; color: #475569; font-size: 14px; line-height: 1.5;">This code expires in ${expiresIn} minutes.</div>
                </div>
                <p style="margin: 24px 0 0; color: #475569; font-size: 14px; line-height: 1.5;">If you did not request this code, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.5;">You are receiving this email because a sign-in was requested for Woops. If you need help, contact Woops support.</p>
              </td>
            </tr>
          </table>
          <p style="max-width: 600px; margin: 16px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">Woops</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
          text: `Woops\n\nSECURITY\nYour verification code\n\n${plainRecipientContext}Use this six-digit verification code to sign in to Woops.\n\nVerification code: ${plainCode}\nThis code expires in ${plainExpiresIn} minutes.\n\nIf you did not request this code, you can safely ignore this email.\n\nYou are receiving this email because a sign-in was requested for Woops. If you need help, contact Woops support.`,
        };
      },
    };
    return templates[template]?.(data) ?? { html: '', text: '' };
  }

  private templateSubject(template: string): string {
    const subjects: Record<string, string> = {
      otp: 'Your Woops verification code',
    };
    return subjects[template] ?? '';
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>'"]/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
        character,
    );
  }
}
