// Better Auth's sign-up/sign-in body schema hardcodes z.email() — there is no
// config flag to relax it. The `users.email` column is really a username slot
// (admin panel calls it that), so every caller stores/sends a synthetic
// address here and this module is the only place that knows the suffix.
const USERNAME_DOMAIN = "users.monkyesuite.internal";
const SUFFIX = `@${USERNAME_DOMAIN}`;

/** Username -> the email-shaped string Better Auth requires. Already-email
 * input (contains "@") passes through untouched. */
export function toAuthEmail(input: string): string {
  const trimmed = input.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}${SUFFIX}`;
}

/** Email-shaped storage value -> what a collaborator should see. Strips the
 * synthetic suffix; leaves a real email (no suffix match) untouched. */
export function toDisplayUsername(email: string): string {
  return email.endsWith(SUFFIX) ? email.slice(0, -SUFFIX.length) : email;
}
