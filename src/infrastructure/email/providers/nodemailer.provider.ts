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
    const html = this.renderTemplate(params.template, params.data);
    return this.send({
      to: params.to,
      subject: this.templateSubject(params.template),
      html,
      from: params.from,
    });
  }

  async verifyAddress(_email: string): Promise<boolean> {
    return true;
  }

  private renderTemplate(template: string, data: Record<string, unknown>): string {
    const templates: Record<string, (d: Record<string, unknown>) => string> = {
      otp: (d) => `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Your OTP Code</h2>
          <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; text-align: center; 
                     background: #f3f4f6; padding: 16px; border-radius: 8px;">
            ${d.code}
          </p>
          <p style="color: #6b7280;">This code expires in ${d.expiresIn} minutes.</p>
          <p style="color: #6b7280; font-size: 12px;">If you didn't request this, ignore this email.</p>
        </div>`,
    };
    return templates[template]?.(data) ?? '';
  }

  private templateSubject(template: string): string {
    const subjects: Record<string, string> = {
      otp: 'Your OTP Code',
    };
    return subjects[template] ?? '';
  }
}
