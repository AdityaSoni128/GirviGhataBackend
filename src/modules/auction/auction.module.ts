import { Module } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { AuctionController } from './auction.controller';
import { CalculationEngineModule } from '../calculation-engine/calculation-engine.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [CalculationEngineModule, PaymentsModule],
  providers: [AuctionService],
  controllers: [AuctionController],
})
export class AuctionModule {}
