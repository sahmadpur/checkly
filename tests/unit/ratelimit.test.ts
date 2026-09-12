import { expect, test, vi } from "vitest";
import { rateLimit } from "@/lib/ratelimit";

test("allows up to capacity then blocks, refills over time", () => {
  vi.useFakeTimers();
  const key = "ip:1.2.3.4";
  for (let i = 0; i < 5; i++) expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(true);
  expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(true);
  vi.useRealTimers();
});
