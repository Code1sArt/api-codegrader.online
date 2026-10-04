import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Language } from '@prisma/client';

export class CreateSubmissionDto {
  @IsString() @IsNotEmpty() problemId: string;
  @IsEnum(Language) language: Language;
  @IsString() @IsNotEmpty() @MaxLength(100_000) sourceCode: string;
  @IsOptional() @IsString() @IsNotEmpty() competitionId?: string;
}
