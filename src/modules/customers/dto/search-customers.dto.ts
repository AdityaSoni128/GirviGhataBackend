import { IsIn, IsOptional, IsString } from 'class-validator';

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

  /** Validated against an allowlist in CustomersService — unrecognized
   * values fall back to the default sort rather than erroring. */
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
