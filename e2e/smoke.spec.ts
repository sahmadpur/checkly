import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();
const ownerEmail = `owner${stamp}@test.local`;
const workerEmail = `worker${stamp}@test.local`;

test("owner signs up, creates property, invites worker; worker sees only that property", async ({ page, browser }) => {
  await page.goto("/signup");
  await page.fill("#orgName", "E2E Org");
  await page.fill("#name", "Owner");
  await page.fill("#email", ownerEmail);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();

  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa One");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa One" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa Two");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa Two" })).toBeVisible();

  await page.goto("/team");
  await page.fill("#email", workerEmail);
  await page.selectOption("#role", "WORKER");
  await page.getByLabel("Villa One").check();
  await page.click("button[type=submit]");
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });

  const ctx = await browser.newContext();
  const worker = await ctx.newPage();
  await worker.goto(`/invite/${invite.token}`);
  await worker.fill("#name", "Worker");
  await worker.fill("#password", "password123");
  await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Properties" })).toBeVisible();
  await expect(worker.getByText("Villa One")).toBeVisible();
  await expect(worker.getByText("Villa Two")).toHaveCount(0);
  await expect(worker.getByRole("link", { name: "Team" })).toHaveCount(0);
  await ctx.close();
});
