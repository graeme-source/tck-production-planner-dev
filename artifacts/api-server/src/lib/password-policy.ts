import { z } from "zod";

// Central password policy — applied everywhere a password is set:
// invite accept, reset link, admin user create/edit, in-app change.
// Rules: more than 8 characters, at least one capital letter, at least one number.
export const PASSWORD_POLICY_MESSAGE =
  "Password must be more than 8 characters and include a capital letter and a number";

export const passwordPolicySchema = z
  .string()
  .min(9, "Password must be more than 8 characters")
  .regex(/[A-Z]/, "Password must include a capital letter")
  .regex(/[0-9]/, "Password must include a number");

/** Returns null if valid, otherwise the first failing rule's message. */
export function validatePassword(password: string): string | null {
  const parsed = passwordPolicySchema.safeParse(password);
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? PASSWORD_POLICY_MESSAGE;
}
