import { Global, Module } from '@nestjs/common';
import { AIAdapterModule } from '../ai-adapter/ai-adapter.module';
import { LLMRuntimeService } from './llm-runtime.service';

@Global()
@Module({
  imports: [AIAdapterModule],
  providers: [LLMRuntimeService],
  exports: [LLMRuntimeService],
})
export class LLMRuntimeModule {}
