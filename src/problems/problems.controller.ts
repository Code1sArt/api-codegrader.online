import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/auth-user';
import { Roles } from '../common/roles.decorator';
import {
  CreateProblemDto,
  SetProblemStatusDto,
  UpdateProblemDto,
  UploadTestCaseDto,
} from './dto/problem.dto';
import { ProblemsService } from './problems.service';

@ApiTags('Problems')
@ApiBearerAuth()
@Controller('problems')
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.problems.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.problems.get(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProblemDto) {
    return this.problems.create(user, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProblemDto) {
    return this.problems.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetProblemStatusDto) {
    return this.problems.setStatus(id, dto.status);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/test-cases')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'inputFile', maxCount: 1 }, { name: 'solutionFile', maxCount: 1 }],
      { limits: { fileSize: 2 * 1024 * 1024, files: 2 } },
    ),
  )
  uploadTestCase(
    @Param('id') id: string,
    @Body() dto: UploadTestCaseDto,
    @UploadedFiles() files: { inputFile?: Express.Multer.File[]; solutionFile?: Express.Multer.File[] },
  ) {
    return this.problems.addTestCase(id, dto, files);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':problemId/test-cases/:testCaseId')
  removeTestCase(@Param('problemId') problemId: string, @Param('testCaseId') testCaseId: string) {
    return this.problems.removeTestCase(problemId, testCaseId);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.problems.remove(id);
  }
}
