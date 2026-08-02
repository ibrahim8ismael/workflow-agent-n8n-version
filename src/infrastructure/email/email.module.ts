import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';

@Global()
@Module({
  providers: [NodemailerEmailProvider, TwilioSmsProvider, NotificationService],
  exports: [NotificationService],
})
export class EmailModule {}
