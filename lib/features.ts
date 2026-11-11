/**
 * Server-side feature flags. Single source of truth: read these only on the
 * server and pass the result to client components as props. Do not add a
 * NEXT_PUBLIC_ twin (it would be inlined at build time and could drift).
 */

type Env = Record<string, string | undefined>;

/**
 * EMAIL_FLOWS_ENABLED: everything that depends on sending email (account
 * verification, password recovery). Off unless explicitly set to "true" / "1",
 * because there is no email provider yet. While off:
 *  - registration signs the user in directly (accounts stay isVerified=false),
 *  - login does not require a verified email,
 *  - verification and password-reset actions return FEATURE_DISABLED,
 *  - no tokens, links or email addresses are logged.
 *
 * Read at call time (not at module load) so tests and deployments can change it.
 */
export function isEmailFlowEnabled(env: Env = process.env): boolean {
  const value = env.EMAIL_FLOWS_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}
