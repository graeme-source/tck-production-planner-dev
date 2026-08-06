// Client-side mirror of the server password policy
// (api-server/src/lib/password-policy.ts). Keep the rules in sync.

export type PasswordRule = { label: string; test: (pw: string) => boolean };

export const PASSWORD_RULES: PasswordRule[] = [
  { label: "More than 8 characters", test: (pw) => pw.length > 8 },
  { label: "At least one capital letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "At least one number", test: (pw) => /[0-9]/.test(pw) },
];

/** Returns null if valid, otherwise the first failing rule's label. */
export function validatePassword(pw: string): string | null {
  const failed = PASSWORD_RULES.find((r) => !r.test(pw));
  return failed ? failed.label : null;
}
