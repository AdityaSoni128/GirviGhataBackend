import { IsArray, IsIn, IsInt, IsNumberString, IsOptional, IsString, Min } from 'class-validator';

export class CreateRuleSetDto {
  @IsString()
  metalCode!: string;

  @IsNumberString()
  eligibilityPercent!: string;

  @IsIn(['FIXED', 'PERCENT', 'NONE'])
  marginType!: 'FIXED' | 'PERCENT' | 'NONE';

  @IsNumberString()
  marginValue!: string;

  @IsIn(['FLAT_MONTHLY', 'DAILY', 'REDUCING_BALANCE'])
  interestMethod!: 'FLAT_MONTHLY' | 'DAILY' | 'REDUCING_BALANCE';

  @IsNumberString()
  interestPercent!: string;

  @IsInt()
  @Min(0)
  gracePeriodDays!: number;

  @IsOptional()
  @IsInt()
  loanTermDays?: number;

  @IsIn(['NONE', 'ROUND_NEAREST_1', 'ROUND_NEAREST_10'])
  roundingRule!: 'NONE' | 'ROUND_NEAREST_1' | 'ROUND_NEAREST_10';

  @IsOptional()
  @IsNumberString()
  minLoanAmount?: string;

  @IsOptional()
  @IsNumberString()
  maxLoanAmount?: string;

  @IsArray()
  paymentAllocationOrder!: Array<'PENALTY' | 'CHARGES' | 'INTEREST' | 'PRINCIPAL'>;
}
