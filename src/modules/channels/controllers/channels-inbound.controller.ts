import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { InterServiceAuthGuard } from '../../../common/guards/inter-service-auth.guard';
import {
  type InboundChannelMessageDto,
  inboundChannelMessageSchema,
} from '../dto/inbound-channel-message.dto';
import { ChannelsInboundService } from '../services/channels-inbound.service';

@Controller('channels')
export class ChannelsInboundController {
  constructor(private readonly inboundService: ChannelsInboundService) {}

  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InterServiceAuthGuard)
  async handleInbound(@Body() body: InboundChannelMessageDto) {
    const dto = inboundChannelMessageSchema.parse(body);
    const result = await this.inboundService.processInboundMessage(dto);
    return {
      success: true,
      data: result,
    };
  }
}
