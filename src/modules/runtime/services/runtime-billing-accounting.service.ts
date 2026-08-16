import { Injectable } from '@nestjs/common';
import { BillingEventService } from '../../billing/services/billing-event.service';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { UsageMeterService } from '../../billing/services/usage-meter.service';
import { RunsService } from '../../runs/runs.service';

@Injectable()
export class RuntimeBillingAccountingService {
  constructor(
    private readonly runs: RunsService,
    private readonly subscriptions: SubscriptionService,
    private readonly usageMeter: UsageMeterService,
    private readonly billingEvents: BillingEventService,
  ) {}

  async recordRun(runId: string): Promise<{ accounted: boolean; credits?: bigint }> {
    const run = await this.runs.findById(runId);
    const scope = run.organizationId
      ? { organizationId: run.organizationId }
      : run.userId
        ? { userId: run.userId }
        : undefined;
    if (!scope) return { accounted: false };

    const subscription = await this.subscriptions.getCurrent(scope.userId, scope.organizationId);
    if (subscription?.status !== 'ACTIVE') return { accounted: false };

    const existing = await this.billingEvents.findByEntity('runtime_run', runId, 1);
    if (existing.length > 0) return { accounted: true };

    const credits = BigInt(Math.max(1, Math.ceil(Number(run.estimatedCost ?? 0))));
    await this.usageMeter.recordAiCreditsUsage(subscription.id, credits);
    await this.billingEvents.logEvent({
      type: 'OPERATION_CONSUMED',
      entityType: 'runtime_run',
      entityId: runId,
      userId: run.userId ?? undefined,
      organizationId: run.organizationId ?? undefined,
      metadata: {
        subscriptionId: subscription.id,
        credits: Number(credits),
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        totalTokens: run.totalTokens,
        estimatedCost: Number(run.estimatedCost ?? 0),
      },
    });
    return { accounted: true, credits };
  }
}
