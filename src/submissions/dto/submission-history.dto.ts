import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsNotEmpty, MaxLength, Min, Max, ValidateIf } from 'class-validator';

export class SubmissionHistoryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
export class ResetScoresDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(200) userId?: string;
}
