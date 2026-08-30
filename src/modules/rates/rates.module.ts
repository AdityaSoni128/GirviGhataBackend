import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { MetalsService } from './metals.service';
import { MetalsController } from './metals.controller';

@Module({
  providers: [RatesService, MetalsService],
  controllers: [RatesController, MetalsController],
  exports: [RatesService, MetalsService],
})
export class RatesModule {}
