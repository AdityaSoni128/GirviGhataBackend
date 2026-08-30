import { Module } from '@nestjs/common';
import { GirviService } from './girvi.service';
import { GirviController } from './girvi.controller';
import { CalculationEngineModule } from '../calculation-engine/calculation-engine.module';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [CalculationEngineModule, RulesModule],
  providers: [GirviService],
  controllers: [GirviController],
  exports: [GirviService],
})
export class GirviModule {}
