import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PledgedItemInputDto {
  @IsString()
  itemType!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  metalCode!: string; // "GOLD" | "SILVER"

  @IsString()
  purityCode!: string; // must match a configured Purity for this metal/tenant

  @IsNumberString()
  grossWeight!: string;

  @IsOptional()
  @IsNumberString()
  stoneWeight?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  conditionNotes?: string;

  @IsOptional()
  @IsString()
  hallmark?: string;

  @IsOptional()
  @IsString()
  huid?: string;
}

export class CreateGirviDto {
  @IsString()
  customerId!: string;

  @IsString()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PledgedItemInputDto)
  items!: PledgedItemInputDto[];

  @IsNumberString()
  requestedLoanAmount!: string;

  @IsOptional()
  @IsDateString()
  pledgeDate?: string;

  @IsOptional()
  @IsString()
  customerSignatureUrl?: string;

  /**
   * The interest rate (%) to lock in for THIS Girvi transaction. Optional
   * — when omitted, the server defaults to the active BusinessRuleSet's
   * interestPercent for the primary metal (existing behavior, unchanged).
   * When supplied, this value — not the active rule's rate — is
   * permanently stored on the transaction's GirviValuationSnapshot and
   * used for every future interest calculation on this transaction,
   * regardless of later changes to the active BusinessRuleSet.
   * Range-validated server-side in GirviService (0–100) — never trust
   * the frontend's own min/max validators as the enforcement point.
   */
  @IsOptional()
  @IsNumberString()
  interestPercent?: string;
}