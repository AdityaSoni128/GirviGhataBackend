import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class RecordDailyClosingDto {
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsString()
  date?: string; // defaults to today

  @IsNumberString()
  actualCash!: string;

  @IsOptional()
  @IsString()
  discrepancyReason?: string;
}
