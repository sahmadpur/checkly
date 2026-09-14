import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();
const ownerEmail = `sc-owner${stamp}@test.local`;
const workerEmail = `sc-worker${stamp}@test.local`;

test("schedule → tick → worker sees today's checklist; email toggle persists", async ({ page, browser, request }) => {
  await page.goto("/signup");
  await page.fill("#orgName", `SC Org ${stamp}`); await page.fill("#name", "Owner"); await page.fill("#email", ownerEmail); await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa SC"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa SC" })).toBeVisible();
  const propertyUrl = page.url();
  await page.goto("/team");
  await page.fill("#email", workerEmail); await page.selectOption("#role", "WORKER"); await page.getByLabel("Villa SC").check(); await page.click("button[type=submit]");
  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });
  const wctx = await browser.newContext(); const worker = await wctx.newPage();
  await worker.goto(`/invite/${invite.token}`); await worker.fill("#name", "Worker"); await worker.fill("#password", "password123"); await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Today" })).toBeVisible();

  await page.goto("/templates/new");
  await page.fill("#name", `Daily E2E ${stamp}`); await page.getByLabel("Item label").first().fill("Beds"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: `Daily E2E ${stamp}` })).toBeVisible();

  await page.goto(`${propertyUrl}/schedules/new`);
  await page.selectOption("#templateId", { label: `Daily E2E ${stamp}` });
  await page.getByLabel("Worker").check();
  await page.fill("#dueTime", "23:59");
  await page.click("button[type=submit]");
  await expect(page.getByText("Daily at 23:59")).toBeVisible();

  const tick = await request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(tick.ok()).toBe(true);
  expect((await tick.json()).generated).toBeGreaterThanOrEqual(1);

  await worker.goto("/today");
  await expect(worker.getByRole("link", { name: new RegExp(`Daily E2E ${stamp}`) })).toBeVisible();
  await worker.goto("/notifications");
  await expect(worker.getByText(`New checklist: Daily E2E ${stamp} at Villa SC`)).toBeVisible();

  await worker.goto("/settings");
  await worker.getByLabel("Email notifications").uncheck();
  await worker.reload();
  await expect(worker.getByLabel("Email notifications")).not.toBeChecked();
  await wctx.close();
});
