import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsString()
  @Length(10, 15)
  mobile!: string;

  @IsOptional()
  @IsString()
  altMobile?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  pincode?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  // KYC — optional at creation per Phase 1 Q12 default (configurable per tenant)
  @IsOptional()
  @IsString()
  @Length(12, 12)
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;
}
