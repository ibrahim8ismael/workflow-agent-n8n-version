import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: Array<{ path?: string; message: string; code?: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
      // Preserve field details from ZodValidationPipe (BadRequestException with array body).
      const body = exception.getResponse() as unknown;
      const maybeMessage =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message?: unknown }).message
          : undefined;
      if (Array.isArray(maybeMessage)) {
        errors = maybeMessage.map((entry) => {
          if (typeof entry === 'object' && entry !== null && 'message' in entry) {
            const e = entry as { path?: unknown; message?: unknown; code?: unknown };
            return {
              ...(typeof e.path === 'string' ? { path: e.path } : {}),
              message: typeof e.message === 'string' ? e.message : 'Invalid value',
              ...(typeof e.code === 'string' ? { code: e.code } : {}),
            };
          }
          return { message: typeof entry === 'string' ? entry : 'Invalid value' };
        });
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation error';
      errors = exception.issues.map((issue) => ({
        path: issue.path.join('.') || undefined,
        message: issue.message,
        code: issue.code,
      }));
      this.logger.warn(
        `Validation failed for ${ctx.getRequest<{ method: string; url: string }>().method} ${
          ctx.getRequest<{ method: string; url: string }>().url
        }: ${JSON.stringify(errors)}`,
      );
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Database error';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Database validation error';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${ctx.getRequest<{ method: string; url: string }>().method} ${
          ctx.getRequest<{ method: string; url: string }>().url
        } failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception, {
        extra: { path: ctx.getRequest<{ url?: string }>().url },
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(errors ? { errors } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
