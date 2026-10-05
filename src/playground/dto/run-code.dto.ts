import { Language } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RunCodeDto {
  @IsEnum(Language)
  language: Language;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  sourceCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  stdin = '';
}
