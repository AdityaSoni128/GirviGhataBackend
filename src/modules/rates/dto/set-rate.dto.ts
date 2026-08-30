import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class SetRateDto {
  @IsString()
  metalCode!: string; // "GOLD" | "SILVER"

  @IsNumberString()
  ratePerGram!: string; // Decimal transported as string to avoid float precision loss over JSON

  @IsOptional()
  @IsString()
  branchId?: string;
}
