import { describe, expect, test } from "vitest";
import { presignDownload, presignUpload, storageConfigured } from "@/lib/storage";

describe.skipIf(!storageConfigured())("storage", () => {
  test("presigned PUT then GET round-trips a small buffer", async () => {
    const key = `test/${Date.now()}.txt`;
    const body = Buffer.from("hello checkly");
    const put = await presignUpload({ key, contentType: "text/plain", contentLength: body.length, expiresSec: 60 });
    const res = await fetch(put, { method: "PUT", body, headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) } });
    expect(res.status).toBe(200);
    const get = await presignDownload(key, 60);
    expect(await (await fetch(get)).text()).toBe("hello checkly");
  });

  test("PUT with a different content length is rejected", async () => {
    const key = `test/${Date.now()}-len.txt`;
    const put = await presignUpload({ key, contentType: "text/plain", contentLength: 5, expiresSec: 60 });
    const res = await fetch(put, { method: "PUT", body: Buffer.from("way more than five bytes"), headers: { "Content-Type": "text/plain" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
