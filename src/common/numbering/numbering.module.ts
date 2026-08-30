import { Global, Module } from '@nestjs/common';
import { NumberSequenceService } from './number-sequence.service';

@Global()
@Module({
  providers: [NumberSequenceService],
  exports: [NumberSequenceService],
})
export class NumberingModule {}
