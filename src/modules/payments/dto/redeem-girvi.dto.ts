import { IsOptional, IsString } from 'class-validator';

export class RedeemGirviDto {
  @IsString()
  girviTransactionId!: string;

  @IsOptional()
  @IsString()
  customerAckUrl?: string; // signature/photo acknowledgement, uploaded separately
}
