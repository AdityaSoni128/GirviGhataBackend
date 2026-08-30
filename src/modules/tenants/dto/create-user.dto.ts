import { IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];

  @IsArray()
  @IsString({ each: true })
  branchIds!: string[];
}
