import { Module } from '@nestjs/common';
import { CalculationEngineService } from './calculation-engine.service';

@Module({
  providers: [CalculationEngineService],
  exports: [CalculationEngineService],
})
export class CalculationEngineModule {}
