import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class RecordSaleDto {
  @IsNumberString()
  finalSaleAmount!: string;

  @IsString()
  buyerName!: string;
}

export class ScheduleAuctionDto {
  @IsString()
  scheduledAt!: string; // ISO date string
}

export class MarkEligibleDto {
  @IsOptional()
  @IsNumberString()
  reservePrice?: string;
}
