import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompetitionStatus } from '@prisma/client';

export class CompetitionProblemDto {
  @IsString() @IsNotEmpty() problemId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) score: number;
}

export class CreateCompetitionDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => CompetitionProblemDto)
  problems: CompetitionProblemDto[];
}

export class SetCompetitionStatusDto {
  @IsEnum(CompetitionStatus) status: CompetitionStatus;
}
