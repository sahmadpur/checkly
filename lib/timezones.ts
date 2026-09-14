const SUPPORTED = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
export const TIMEZONES: string[] = SUPPORTED.includes("UTC") ? SUPPORTED : ["UTC", ...SUPPORTED];
const SET = new Set(TIMEZONES);
export const isValidTimezone = (tz: string) => SET.has(tz);
