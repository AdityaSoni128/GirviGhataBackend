import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  branchId!: string;

  @IsIn(['VAULT', 'LOCKER', 'RACK', 'TRAY', 'SHELF'])
  type!: 'VAULT' | 'LOCKER' | 'RACK' | 'TRAY' | 'SHELF';

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
