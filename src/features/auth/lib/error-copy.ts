import type { AuthErrorCode } from '@/features/auth/lib/auth-service';
import { authCopy, formatMmSs } from '@/features/auth/lib/copy';

/**
 * SPEC-001 §8.3 error copy, one table per screen context (SPEC-001-T57). `satisfies` makes a new
 * AuthErrorCode a typecheck failure here. null means "no inline copy": the screen routes, counts
 * down, or (password reset, R29) shows the standard success screen.
 */
export type AuthErrorContext =
  | 'sign_in'
  | 'sign_up'
  | 'password_reset_request'
  | 'password_update'
  | 'resend';

const c = authCopy;

const table = {
  sign_in: {
    invalid_email: c.wrongCredentials,
    password_too_short: c.wrongCredentials,
    password_too_long: c.wrongCredentials,
    breach_check_unavailable: c.wrongCredentials,
    password_breached: c.wrongCredentials,
    network: c.network,
    bad_credentials: c.wrongCredentials,
    email_not_confirmed: null,
    rate_limited: c.signInRateLimited,
    suspended: c.accountSuspended,
    unknown: c.wrongCredentials,
  },
  sign_up: {
    invalid_email: c.invalidEmail,
    password_too_short: c.passwordTooShort,
    password_too_long: c.passwordTooLong,
    breach_check_unavailable: c.breachCheckUnavailable,
    password_breached: c.passwordBreached,
    network: c.network,
    bad_credentials: c.genericError,
    email_not_confirmed: c.genericError,
    rate_limited: c.rateLimitedGeneric,
    suspended: c.genericError,
    unknown: c.genericError,
  },
  // R29: only a true transport failure may differ from the success screen.
  password_reset_request: {
    invalid_email: null,
    password_too_short: null,
    password_too_long: null,
    breach_check_unavailable: null,
    password_breached: null,
    network: c.network,
    bad_credentials: null,
    email_not_confirmed: null,
    rate_limited: null,
    suspended: null,
    unknown: null,
  },
  password_update: {
    invalid_email: c.passwordUpdateFailed,
    password_too_short: c.passwordTooShort,
    password_too_long: c.passwordTooLong,
    breach_check_unavailable: c.breachCheckUnavailable,
    password_breached: c.passwordBreached,
    network: c.network,
    bad_credentials: c.passwordUpdateFailed,
    email_not_confirmed: c.passwordUpdateFailed,
    rate_limited: c.passwordUpdateFailed,
    suspended: c.passwordUpdateFailed,
    unknown: c.passwordUpdateFailed,
  },
  resend: {
    invalid_email: c.resendFailed,
    password_too_short: c.resendFailed,
    password_too_long: c.resendFailed,
    breach_check_unavailable: c.resendFailed,
    password_breached: c.resendFailed,
    network: c.network,
    bad_credentials: c.resendFailed,
    email_not_confirmed: c.resendFailed,
    rate_limited: null, // the countdown handles it
    suspended: c.resendFailed,
    unknown: c.resendFailed,
  },
} satisfies Record<AuthErrorContext, Record<AuthErrorCode, string | null>>;

export function authErrorCopy(code: AuthErrorCode, context: AuthErrorContext): string | null {
  return table[context][code];
}

/** Sign-in rate-limit copy: the live countdown when Retry-After is known, else the interim string. */
export function rateLimitedCopy(context: 'sign_in', retryAfterSec: number | null): string {
  void context;
  return retryAfterSec !== null && retryAfterSec > 0
    ? c.signInRateLimitedIn(formatMmSs(retryAfterSec))
    : c.signInRateLimited;
}
