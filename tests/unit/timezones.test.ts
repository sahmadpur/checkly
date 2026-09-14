import { expect, test } from "vitest";
import { isValidTimezone, TIMEZONES } from "@/lib/timezones";

test("validates IANA names", () => {
  expect(isValidTimezone("Europe/Madrid")).toBe(true);
  expect(isValidTimezone("Mars/Olympus")).toBe(false);
  expect(TIMEZONES).toContain("UTC");
});
