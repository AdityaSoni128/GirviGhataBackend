import { Module } from '@nestjs/common';
import { GirviService } from './girvi.service';
import { GirviController } from './girvi.controller';
import { CalculationEngineModule } from '../calculation-engine/calculation-engine.module';
import { RulesModule } from '../rules/rules.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [CalculationEngineModule, PaymentsModule, RulesModule],
  providers: [GirviService],
  controllers: [GirviController],
  exports: [GirviService],
})
export class GirviModule {}
