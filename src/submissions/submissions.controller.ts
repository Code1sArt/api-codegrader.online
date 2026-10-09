import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { SubmissionHistoryDto, ResetScoresDto } from './dto/submission-history.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/auth-user';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionsService } from './submissions.service';

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post()
  submit(@CurrentUser() user: AuthUser, @Body() dto: CreateSubmissionDto) {
    return this.submissions.submit(user, dto);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.submissions.listMine(user);
  }

  @Get('me/problems')
  mineProblems(@CurrentUser() user: AuthUser) {
    return this.submissions.problemSummaries(user.sub);
  }

  @Get('me/problems/:problemId')
  mineHistory(@CurrentUser() user: AuthUser, @Param('problemId') problemId: string, @Query() query: SubmissionHistoryDto) {
    return this.submissions.history(problemId, user.sub, query.page);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/problems')
  adminProblems() { return this.submissions.problemSummaries(); }

  @Roles(UserRole.ADMIN)
  @Get('admin/problems/:problemId')
  adminRespondents(@Param('problemId') problemId: string) {
    return this.submissions.respondents(problemId);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/problems/:problemId/users/:userId')
  adminHistory(@Param('problemId') problemId: string, @Param('userId') userId: string, @Query() query: SubmissionHistoryDto) {
    return this.submissions.history(problemId, userId, query.page);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/problems/:problemId/reset')
  reset(@Param('problemId') problemId: string, @Body() dto: ResetScoresDto) {
    return this.submissions.resetScores(problemId, dto.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.submissions.get(user, id);
  }
}
