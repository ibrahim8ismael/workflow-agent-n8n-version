import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private provider: 'nodemailer' | 'twilio' = 'nodemailer';

  constructor(
    private readonly nodemailerProvider: NodemailerEmailProvider,
    private readonly twilioProvider: TwilioSmsProvider,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.provider = (this.config.get('NOTIFICATION_PROVIDER') ?? 'nodemailer') as
      | 'nodemailer'
      | 'twilio';
    this.logger.log(`Notification provider: ${this.provider}`);
  }

  async sendOtpEmail(email: string, code: string): Promise<void> {
    await this.nodemailerProvider.sendTemplate({
      to: email,
      template: 'otp',
      data: { code, expiresIn: 5, recipientEmail: email },
    });
    this.logger.log(`OTP email sent to ${email}`);
  }

  async sendOtpSms(phone: string, code: string): Promise<void> {
    await this.twilioProvider.sendOtp(phone, code);
    this.logger.log(`OTP SMS sent to ${phone}`);
  }

  async sendOtp(target: string, code: string): Promise<void> {
    if (this.provider === 'twilio') {
      await this.sendOtpSms(target, code);
    } else {
      await this.sendOtpEmail(target, code);
    }
  }
}
