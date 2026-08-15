// One-off: create the very first user account, bypassing the HTTP gate,
// the same way the /admin panel does internally (signUpEmail in-process).
// Run once, then promote via SQL: UPDATE users SET is_admin = true WHERE email = '<stored value>';
import { auth } from "../src/auth.js";
import { toAuthEmail } from "../src/identity.js";

const [, , username, password, name] = process.argv;
if (!username || !password) {
  console.error("usage: tsx scripts/bootstrap-admin.ts <username> <password> [name]");
  process.exit(1);
}

const result = await auth.api.signUpEmail({
  body: { email: toAuthEmail(username), password, name: name ?? username },
});
console.log("created:", result);
process.exit(0);
