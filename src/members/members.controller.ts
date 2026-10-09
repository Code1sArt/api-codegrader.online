import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../common/roles.decorator";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthUser } from "../common/auth-user";
import { MemberQueryDto, MemberStatusDto } from "./members.dto";
import { MembersService } from "./members.service";
import { GlobalLeaderboardService } from "./leaderboard.service";
@ApiTags("Members")
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller("members")
export class MembersController {
  constructor(private readonly members: MembersService) {}
  @Get() list(@Query() query: MemberQueryDto) {
    return this.members.list(query);
  }
  @Get(":id/history") history(
    @Param("id") id: string,
    @Query() query: MemberQueryDto,
  ) {
    return this.members.history(id, query.page);
  }
  @Patch(":id/status") status(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: MemberStatusDto,
  ) {
    return this.members.setStatus(id, user.sub, dto.isActive);
  }
  @Delete(":id") remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    return this.members.remove(id, user.sub);
  }
}
@ApiTags("Leaderboard")
@ApiBearerAuth()
@Controller("leaderboard")
export class GlobalLeaderboardController {
  constructor(private readonly leaderboard: GlobalLeaderboardService) {}
  @Get() get() {
    return this.leaderboard.get();
  }
}
