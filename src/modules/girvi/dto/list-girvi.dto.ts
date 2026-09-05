import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListGirviDto {
  @IsOptional()
  @IsString()
  status?: string;

  /** Server-side search across girviNumber, customer name, and customer
   * mobile — matched against the full dataset in Postgres, not just the
   * currently-loaded page. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  /** Validated against an allowlist in GirviService — unrecognized values
   * fall back to the default sort rather than erroring. */
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  /** Inclusive pledgeDate range filter, ISO date strings. */
  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}
