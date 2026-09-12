import { IsDateString, IsNotEmpty } from 'class-validator';

export class UpdatePledgeDateDto {
  @IsNotEmpty()
  @IsDateString()
  pledgeDate!: string;
}