import { expect, test } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/tick/route";

test("401 without the secret, 200 with counts", async () => {
  process.env.CRON_SECRET = "s3cret";
  const bad = await POST(new NextRequest("http://x/api/cron/tick", { method: "POST" }));
  expect(bad.status).toBe(401);
  const ok = await POST(new NextRequest("http://x/api/cron/tick", { method: "POST", headers: { authorization: "Bearer s3cret" } }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ generated: 0, errors: 0 });
});
