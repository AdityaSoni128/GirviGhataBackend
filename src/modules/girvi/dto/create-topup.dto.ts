import { IsBoolean, IsDateString, IsNumberString, IsOptional } from 'class-validator';

export class CreateTopUpDto {
  @IsNumberString()
  amount!: string;

  /**
   * Actual date the top-up money was given, for backdated/historical
   * entry — same convention as CreateGirviDto.pledgeDate. Optional;
   * server defaults to today when omitted.
   */
  @IsOptional()
  @IsDateString()
  topUpDate?: string;

  /**
   * The owner's explicit interest-anchor decision (see GirviTopUp model
   * comment). Required — this is a financial decision, not something
   * the server should default silently.
   */
  @IsBoolean()
  applyPreviousInterestStartDate!: boolean;
}