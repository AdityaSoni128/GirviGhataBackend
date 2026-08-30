import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { OutstandingService } from './outstanding.service';
import { RedemptionService } from './redemption.service';
import { RedemptionController } from './redemption.controller';
import { CalculationEngineModule } from '../calculation-engine/calculation-engine.module';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [CalculationEngineModule, RulesModule],
  providers: [PaymentsService, OutstandingService, RedemptionService],
  controllers: [PaymentsController, RedemptionController],
  exports: [PaymentsService, OutstandingService],
})
export class PaymentsModule {}
