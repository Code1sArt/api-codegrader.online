import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AuthUser } from "./auth-user";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { PRIVACY_POLICY } from "../members/privacy";
export const WITHOUT_CONSENT = "withoutConsent";
export const AllowWithoutConsent = () => SetMetadata(WITHOUT_CONSENT, true);
@Injectable()
export class PrivacyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(WITHOUT_CONSENT, targets)
    )
      return true;
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (request.user?.privacyVersion !== PRIVACY_POLICY.version)
      throw new ForbiddenException({
        code: "PRIVACY_ACCEPTANCE_REQUIRED",
        message: "กรุณายอมรับข้อมูลความเป็นส่วนตัวก่อนใช้งาน",
      });
    return true;
  }
}
