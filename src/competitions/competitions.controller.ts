import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/auth-user';
import { Roles } from '../common/roles.decorator';
import { CompetitionsService } from './competitions.service';
import { CreateCompetitionDto, SetCompetitionStatusDto } from './dto/competition.dto';

@ApiTags('Competitions')
@ApiBearerAuth()
@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly competitions: CompetitionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.competitions.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.competitions.get(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompetitionDto) {
    return this.competitions.create(user, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetCompetitionStatusDto) {
    return this.competitions.setStatus(id, dto.status);
  }

  @Post(':id/join')
  join(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.competitions.join(user, id);
  }

  @Get(':id/leaderboard')
  leaderboard(@Param('id') id: string) {
    return this.competitions.leaderboard(id);
  }
}
