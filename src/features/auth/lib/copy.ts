export const authCopy = {
  wrongCredentials: "That email and password don't match. Check both and try again.",
  passwordTooShort: 'Passwords need at least 12 characters. Length beats complexity.',
  passwordTooLong: 'Passwords can be at most 128 characters.',
  breachCheckUnavailable: "We couldn't check this password against known breaches. Try again.",
  passwordBreached:
    "This password has appeared in a known data breach. Pick a different one — it doesn't have to be complicated, just not this one.",
  providerFailed: (provider: 'Apple' | 'Google') =>
    `${provider} sign-in didn't complete. You can try again, or sign in with your email and password.`,
  accountSuspended:
    "This account is suspended. Email support@sharecropr.app if you think that's a mistake.",
  offline: "You're offline. Signing in needs a connection.",
  verifyTitle: 'Check your email',
  verifyBody: (email: string) =>
    `We sent a confirmation link to ${email}. Tap it and you're in.`,
  resendAvailable: "Didn't arrive? Resend",
  resendCooldown: (mmss: string) => `You can resend in ${mmss}.`,
  resetSuccess: (email: string) =>
    `If there's an account for ${email}, a reset link is on its way. It expires in 60 minutes.`,
  deleteTitle: 'Delete your account',
  deleteBody:
    "We'll erase your garden location, your photos, your messages, and your profile. It happens 30 days from now. Sign in any time before then and we'll stop it.",
  deleteRetention:
    "We keep a record that a verification was completed — not your ID, which we never had — for 7 years, because we're required to. Everything else goes.",
  deleteConfirm: 'Delete my account',
  deleteTypePrompt: 'Type DELETE to confirm',
  deleteScheduled: (date: string) =>
    `Your account will be deleted on ${date}. You can still sign in until then to cancel.`,
  aal2Required: 'Enter the code from your authenticator app to confirm this.',
  restoreTitle: 'Welcome back — want to keep your account?',
  restoreBody: (requestDate: string, scheduledDate: string) =>
    `You asked us to delete this account on ${requestDate}. We haven't yet. Deletion is scheduled for ${scheduledDate}.`,
  restoreKeep: 'Keep my account',
  restoreContinue: 'Continue with deletion',
  graceElapsed:
    "This account was deleted and can't be recovered. You're welcome to start a new one.",
  network: "We couldn't reach Sharecropr. Check your connection and try again.",
  signInRateLimited: 'Too many sign-in attempts. Wait a few minutes and try again.',
  accountStatusTitle: "We couldn't check your account",
  accountStatusBody: 'Check your connection and try again.',
  tryAgain: 'Try again',
  signOut: 'Sign out',
  restoreFailed: "We couldn't restore your account just now. Try again.",
  resetLinkInvalidTitle: "That reset link didn't work",
  resetLinkInvalidBody:
    'Reset links work once, expire after 60 minutes, and open only on the device that asked for them. Request a new one.',
  resetLinkRequestNew: 'Request a new link',
  backToSignIn: 'Back to sign in',
} as const;

export function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
