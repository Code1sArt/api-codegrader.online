import type { AuthUser } from './auth-user';
import { normalizeIp } from '@nestjs/throttler';

// JwtAuthGuard must run first: never derive a quota from an unverified token.
export function requestTracker(request: { user?: AuthUser; ip?: string }) {
  return request.user ? `user:${request.user.sub}` : `ip:${normalizeIp(request.ip ?? 'unknown')}`;
}
