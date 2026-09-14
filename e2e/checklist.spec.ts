import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "node:path";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();
const ownerEmail = `cl-owner${stamp}@test.local`;
const workerEmail = `cl-worker${stamp}@test.local`;

test("template → assign → fill with photo → reject → resubmit → approve", async ({ page, browser }) => {
  test.skip(!process.env.S3_ENDPOINT, "needs MinIO");

  // Owner signs up, creates a property, invites the worker
  await page.goto("/signup");
  await page.fill("#orgName", "CL Org"); await page.fill("#name", "Owner"); await page.fill("#email", ownerEmail); await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa E2E"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa E2E" })).toBeVisible();
  const propertyUrl = page.url();
  await page.goto("/team");
  await page.fill("#email", workerEmail); await page.selectOption("#role", "WORKER"); await page.getByLabel("Villa E2E").check();
  await page.click("button[type=submit]");
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });

  // Worker accepts
  const wctx = await browser.newContext();
  const worker = await wctx.newPage();
  await worker.goto(`/invite/${invite.token}`);
  await worker.fill("#name", "Worker"); await worker.fill("#password", "password123"); await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Today" })).toBeVisible();

  // Owner builds a template: checkbox, text (optional), photo
  await page.goto("/templates/new");
  await page.fill("#name", "Clean E2E");
  await page.getByLabel("Item label").first().fill("Beds made");
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.getByLabel("Item label").nth(1).fill("Notes");
  await page.getByLabel("Required").nth(1).uncheck();
  await page.getByRole("button", { name: "+ Photo" }).click();
  await page.getByLabel("Item label").nth(2).fill("Bathroom");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Clean E2E" })).toBeVisible();

  // Owner assigns it to the worker
  await page.goto(propertyUrl);
  await page.selectOption("#templateId", { label: "Clean E2E" });
  await page.getByLabel("Worker").check();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Assigned to 1 worker.")).toBeVisible();

  // Worker fills it in
  await worker.goto("/today");
  await worker.getByRole("link", { name: /Clean E2E/ }).click();
  await worker.getByRole("button", { name: "Mark done" }).click();
  await expect(worker.getByText("✓ Done")).toBeVisible();
  await worker.setInputFiles('input[type=file]', path.join(__dirname, "fixtures/photo.jpg"));
  await expect(worker.getByText("2 of 2 required done")).toBeVisible({ timeout: 15_000 });
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();

  // Owner rejects, worker resubmits, owner approves
  const inst = await db.checklistInstance.findFirstOrThrow({ where: { templateName: "Clean E2E" }, orderBy: { createdAt: "desc" } });
  await page.goto(`/checklists/${inst.id}`);
  await page.getByLabel("Review comment").fill("Redo the beds");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Needs rework").first()).toBeVisible();
  await worker.reload();
  await expect(worker.getByText("Redo the beds")).toBeVisible();
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved")).toBeVisible();
  await wctx.close();
});
