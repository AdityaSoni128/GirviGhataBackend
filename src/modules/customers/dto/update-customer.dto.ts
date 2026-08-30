import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateCustomerDto } from './create-customer.dto';

// mobile/aadhaar/pan changes go through dedicated endpoints in a fuller
// implementation (they're sensitive/identity fields); this DTO covers the
// general profile-edit case (Section 6).
export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['aadhaarNumber', 'panNumber'] as const),
) {}
