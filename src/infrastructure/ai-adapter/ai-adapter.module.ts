import { Global, Module } from '@nestjs/common';
import { AIAdapterService } from './ai-adapter.service';

@Global()
@Module({
  providers: [AIAdapterService],
  exports: [AIAdapterService],
})
export class AIAdapterModule {}
