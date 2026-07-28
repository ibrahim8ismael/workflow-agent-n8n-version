import { registerAs } from '@nestjs/config';

export const emailConfig = registerAs('email', () => ({
  provider: process.env.EMAIL_PROVIDER ?? 'resend',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
}));
