import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Returns E.164 or null. Input must include the country code (leading +). */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed);
  return parsed?.isValid() ? parsed.number : null;
}
