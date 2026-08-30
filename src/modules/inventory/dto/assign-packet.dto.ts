import { IsOptional, IsString } from 'class-validator';

export class AssignPacketDto {
  @IsString()
  girviTransactionId!: string;

  @IsOptional()
  @IsString()
  storageLocationId?: string;
}
