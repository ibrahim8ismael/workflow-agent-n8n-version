import { Injectable, Logger } from '@nestjs/common';

export interface ToolAuditEvent {
  event: 'tool.started' | 'tool.completed' | 'tool.failed';
  runId: string;
  toolId: string;
  logicalAction?: string;
  durationMs?: number;
  errorCode?: string;
  retryable?: boolean;
  userId?: string;
  organizationId?: string;
}

@Injectable()
export class ToolAuditService {
  private readonly logger = new Logger(ToolAuditService.name);

  record(event: ToolAuditEvent): void {
    this.logger.log(event);
  }
}
