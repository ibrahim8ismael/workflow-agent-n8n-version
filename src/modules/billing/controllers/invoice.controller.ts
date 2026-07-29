import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { InvoiceService } from '../services/invoice.service';
import { SubscriptionService } from '../services/subscription.service';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getInvoices(@Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    const sub = await this.subscriptionService.getCurrent(
      activeContext === 'organization' ? undefined : userId,
      activeContext === 'organization' ? organizationId : undefined,
    );
    if (!sub) return [];
    return this.invoiceService.findBySubscriptionId(sub.id);
  }

  @Get(':id')
  async getInvoice(@Param('id') id: string) {
    return this.invoiceService.findById(id);
  }
}
