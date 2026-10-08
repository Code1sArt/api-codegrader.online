import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Language, ProblemStatus } from '@prisma/client';

export class CreateProblemDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string;
  @IsString() @IsNotEmpty() title: string;
  @IsString() @IsNotEmpty() statement: string;
  @IsOptional() @IsString() inputDescription?: string;
  @IsOptional() @IsString() outputDescription?: string;
  @IsOptional() @IsString() constraints?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) difficulty?: number;
  @IsArray() @ArrayNotEmpty() @IsEnum(Language, { each: true }) allowedLanguages: Language[];
  @IsInt() @Min(100) @Max(60_000) timeLimitMs: number;
  @IsInt() @Min(16) @Max(2048) memoryLimitMb: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) maxScore: number;
}

export class UpdateProblemDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() @IsNotEmpty() statement?: string;
  @IsOptional() @IsString() inputDescription?: string;
  @IsOptional() @IsString() outputDescription?: string;
  @IsOptional() @IsString() constraints?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) difficulty?: number;
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsEnum(Language, { each: true }) allowedLanguages?: Language[];
  @IsOptional() @IsInt() @Min(100) @Max(60_000) timeLimitMs?: number;
  @IsOptional() @IsInt() @Min(16) @Max(2048) memoryLimitMb?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) maxScore?: number;
}

export class SetProblemStatusDto {
  @IsEnum(ProblemStatus) status: ProblemStatus;
}

export class SubtaskDto {
  @IsString() @IsNotEmpty() @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99) score: number;
  @IsInt() @Min(1) position: number;
}

export class AssignTestCaseDto {
  // An empty ID moves a test back to individual scoring.
  @IsString() subtaskId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999.99) score: number;
}

export class UploadTestCaseDto {
  @IsOptional() @IsString() subtaskId?: string;
  @IsString() @IsNotEmpty() name: string;
  @Type(() => Number) @IsInt() @Min(1) position: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999.99) score: number;
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isSample = false;
}

export class UploadTestCaseZipDto {
  @IsString() @IsNotEmpty() subtaskId: string;
}
