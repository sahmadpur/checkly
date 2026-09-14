import { expect, test } from "vitest";
import { extForMime, mediaKey, mediaKeyPrefix, mediaRule } from "@/lib/media";

test("ext and keys", () => {
  expect(extForMime("image/jpeg")).toBe("jpg");
  expect(extForMime("video/quicktime")).toBe("mov");
  expect(extForMime("text/plain")).toBeNull();
  expect(mediaKey("o1", "i1", "t1", "jpg")).toBe("org/o1/instances/i1/t1.jpg");
  expect(mediaKey("o1", "i1", "t1", "jpg").startsWith(mediaKeyPrefix("o1", "i1", "t1"))).toBe(true);
});

test("rules", () => {
  expect(mediaRule("PHOTO")).toEqual({ types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024, presignSec: 300 });
  expect(mediaRule("VIDEO").maxBytes).toBe(100 * 1024 * 1024);
});
