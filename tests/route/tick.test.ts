import { afterEach, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/tick/route";

const originalSecret = process.env.CRON_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

const req = (headers?: Record<string, string>) => new NextRequest("http://x/api/cron/tick", { method: "POST", headers });

test("401 without the secret, 200 with counts", async () => {
  process.env.CRON_SECRET = "s3cret";
  const bad = await POST(req());
  expect(bad.status).toBe(401);
  const ok = await POST(req({ authorization: "Bearer s3cret" }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ generated: 0, errors: 0 });
});

test("401 with the wrong secret", async () => {
  process.env.CRON_SECRET = "s3cret";
  const res = await POST(req({ authorization: "Bearer wrong" }));
  expect(res.status).toBe(401);
});

test("401 when CRON_SECRET is unset", async () => {
  delete process.env.CRON_SECRET;
  const res = await POST(req({ authorization: "Bearer anything" }));
  expect(res.status).toBe(401);
});
