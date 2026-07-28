import { Module } from '@nestjs/common';
import { RuntimeService } from './services/runtime.service';
import { RuntimeRepository } from './repositories/runtime.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [RuntimeService, RuntimeRepository],
  exports: [RuntimeService],
})
export class RuntimeModule {}
