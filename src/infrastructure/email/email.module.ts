import { Global, Module } from '@nestjs/common';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';
import { NotificationService } from './notification.service';

@Global()
@Module({
  providers: [NodemailerEmailProvider, TwilioSmsProvider, NotificationService],
  exports: [NotificationService],
})
export class EmailModule {}
