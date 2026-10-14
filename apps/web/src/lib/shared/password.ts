/**
 * How strong a new password looks, from 0 (nothing typed) to 4: its length first (10 characters are required,
 * 16 make it strong), then the kinds of characters mixed in. A hint for the person, not a rule: the server only
 * asks for the length
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 10) return password.length ? 1 : 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(password)).length;
  const score = 1 + (password.length >= 16 ? 2 : password.length >= 12 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
