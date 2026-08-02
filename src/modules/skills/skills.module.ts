import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SkillsController } from './controllers/skills.controller';
import { SkillsRepository } from './repositories/skills.repository';
import { SkillsService } from './services/skills.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SkillsController],
  providers: [SkillsService, SkillsRepository],
  exports: [SkillsService],
})
export class SkillsModule {}
