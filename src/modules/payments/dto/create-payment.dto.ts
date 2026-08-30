import { IsDateString, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  girviTransactionId!: string;

  @IsNumberString()
  amount!: string;

  @IsIn(['CASH', 'UPI', 'BANK', 'OTHER'])
  mode!: 'CASH' | 'UPI' | 'BANK' | 'OTHER';

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * The actual date the payment was received, for entering historical/
   * backdated payments. ISO date string (e.g. "2025-05-20"). Optional —
   * when omitted, defaults to now, preserving previous behavior. The
   * server rejects a date in the future and (see PaymentsService) a date
   * earlier than the transaction's pledgeDate, since a payment cannot
   * predate the loan it's paying off.
   */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}