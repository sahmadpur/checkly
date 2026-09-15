import "dotenv/config";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "node:path";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();

/** Owner signs up with their own org and property, invites a worker, worker accepts. */
async function setupOrg(page: Page, browser: Browser, tag: string) {
  const ownerEmail = `cl-owner-${tag}${stamp}@test.local`;
  const workerEmail = `cl-worker-${tag}${stamp}@test.local`;
  const propertyName = `Villa ${tag} ${stamp}`;

  await page.goto("/signup");
  await page.fill("#orgName", `CL Org ${tag}`); await page.fill("#name", "Owner"); await page.fill("#email", ownerEmail); await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", propertyName); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: propertyName })).toBeVisible();
  const propertyUrl = page.url();

  await page.goto("/team");
  await page.fill("#email", workerEmail); await page.selectOption("#role", "WORKER"); await page.getByLabel(propertyName).check();
  await page.click("button[type=submit]");
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });

  const wctx = await browser.newContext();
  const worker = await wctx.newPage();
  await worker.goto(`/invite/${invite.token}`);
  await worker.fill("#name", "Worker"); await worker.fill("#password", "password123"); await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Today" })).toBeVisible();
  return { propertyUrl, worker, wctx };
}

async function assignTo(page: Page, propertyUrl: string, templateName: string) {
  await page.goto(propertyUrl);
  await page.selectOption("#templateId", { label: templateName });
  await page.getByLabel("Worker").check();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Assigned to 1 worker.")).toBeVisible();
}

test("template → assign → fill → reject → resubmit → approve", async ({ page, browser }) => {
  const { propertyUrl, worker, wctx } = await setupOrg(page, browser, "flow");
  const templateName = `Clean E2E ${stamp}`;

  // Owner builds a template: checkbox, text (optional)
  await page.goto("/templates/new");
  await page.fill("#name", templateName);
  await page.getByLabel("Item label").first().fill("Beds made");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByLabel("Item label").nth(1).fill("Notes");
  await page.getByLabel("Required").nth(1).uncheck();
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: templateName })).toBeVisible();

  await assignTo(page, propertyUrl, templateName);

  // Worker fills it in
  await worker.goto("/today");
  await worker.getByRole("link", { name: new RegExp(templateName) }).click();
  await worker.getByRole("button", { name: "Mark done" }).click();
  await expect(worker.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await expect(worker.getByText("1 of 1 required done")).toBeVisible();
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();

  // Owner rejects, worker resubmits, owner approves
  const inst = await db.checklistInstance.findFirstOrThrow({ where: { templateName } });
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

test("photo item: upload, then submit", async ({ page, browser }) => {
  test.skip(!process.env.S3_ENDPOINT, "needs MinIO");
  const { propertyUrl, worker, wctx } = await setupOrg(page, browser, "media");
  const templateName = `Photo E2E ${stamp}`;

  await page.goto("/templates/new");
  await page.fill("#name", templateName);
  // The one default item becomes the photo, so it is the only required one.
  await page.getByLabel("Item type").first().selectOption("PHOTO");
  await page.getByLabel("Item label").first().fill("Bathroom");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: templateName })).toBeVisible();

  await assignTo(page, propertyUrl, templateName);

  await worker.goto("/today");
  await worker.getByRole("link", { name: new RegExp(templateName) }).click();
  await worker.setInputFiles("input[type=file]", path.join(__dirname, "fixtures/photo.jpg"));
  await expect(worker.getByText("1 of 1 required done")).toBeVisible({ timeout: 15_000 });
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();
  await wctx.close();
});
