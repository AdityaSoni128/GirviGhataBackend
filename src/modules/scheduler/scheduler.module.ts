import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OverdueSchedulerService } from './overdue-scheduler.service';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [ScheduleModule.forRoot(), RulesModule],
  providers: [OverdueSchedulerService],
})
export class SchedulerModule {}
