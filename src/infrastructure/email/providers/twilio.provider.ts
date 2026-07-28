import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioSmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private client: Twilio | null = null;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      this.client = new Twilio(accountSid, authToken);
    } else {
      this.logger.warn('Twilio credentials not configured — SMS will be logged only');
    }
  }

  async sendSms(to: string, body: string): Promise<{ sid?: string; success: boolean }> {
    if (!this.client) {
      this.logger.log(`[Twilio mock] SMS to ${to}: ${body}`);
      return { success: true };
    }

    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!from) {
      this.logger.warn('TWILIO_PHONE_NUMBER not set');
      return { success: false };
    }

    const message = await this.client.messages.create({ to, from, body });
    return { sid: message.sid, success: true };
  }

  async sendOtp(phone: string, code: string): Promise<{ sid?: string; success: boolean }> {
    const body = `Your WOOPS verification code is: ${code}. It expires in 5 minutes.`;
    return this.sendSms(phone, body);
  }
}
