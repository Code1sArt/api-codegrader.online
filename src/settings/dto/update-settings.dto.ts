import { IsBoolean } from 'class-validator';

export class UpdateSettingsDto {
  @IsBoolean()
  playgroundEnabled: boolean;
}
