import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password'],
      },
    }),
  ],
})
export class LoggerModule {}
