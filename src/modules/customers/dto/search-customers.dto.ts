import { IsOptional, IsString } from 'class-validator';

export class SearchCustomersDto {
  @IsOptional()
  @IsString()
  q?: string; // matched against name, mobile, customerCode, Aadhaar last 4, PAN

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
