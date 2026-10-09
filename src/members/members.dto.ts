import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { PRIVACY_POLICY } from "./privacy";
export class MemberQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["all", "active", "blocked"]) state: string = "all";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
export class MemberStatusDto {
  @IsBoolean() isActive: boolean;
}
export class AcceptPrivacyDto {
  @IsBoolean() @Equals(true) accepted: boolean;
  @IsIn([PRIVACY_POLICY.version]) version: string;
}
