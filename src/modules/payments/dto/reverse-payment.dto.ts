import { IsString } from 'class-validator';

export class ReversePaymentDto {
  @IsString()
  reason!: string;
}
