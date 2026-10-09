import { Global, Module } from "@nestjs/common";
import { UsageService } from "./usage.service";
import { MembersService } from "./members.service";
import { GlobalLeaderboardService } from "./leaderboard.service";
import {
  MembersController,
  GlobalLeaderboardController,
} from "./members.controller";
@Global()
@Module({
  providers: [UsageService, MembersService, GlobalLeaderboardService],
  controllers: [MembersController, GlobalLeaderboardController],
  exports: [UsageService],
})
export class MembersModule {}
