import { expect, test } from "vitest";
import { buildCopy } from "@/lib/notifications/copy";
import { formatInTz } from "@/lib/format";

const c = { template: "Checkout clean", property: "Villa Azul", dueAt: new Date("2026-03-02T08:00:00Z"), tz: "Europe/Madrid", instanceId: "i1" };

test("formatInTz renders in the org timezone", () => {
  expect(formatInTz(c.dueAt, "Europe/Madrid")).toBe("Mon, Mar 2, 09:00");
  expect(formatInTz(c.dueAt, "UTC")).toBe("Mon, Mar 2, 08:00");
});

test("copy per type", () => {
  expect(buildCopy("ASSIGNED", c)).toEqual({ title: "New checklist: Checkout clean at Villa Azul", body: "Due Mon, Mar 2, 09:00", url: "/checklists/i1" });
  expect(buildCopy("DUE_SOON", c).title).toBe("Due in 1 hour: Checkout clean at Villa Azul");
  expect(buildCopy("OVERDUE", c).title).toBe("Overdue: Checkout clean at Villa Azul");
  expect(buildCopy("REJECTED", { ...c, comment: "Redo beds" })).toMatchObject({ title: "Needs rework: Checkout clean at Villa Azul", body: "Redo beds" });
  expect(buildCopy("APPROVED", c).title).toBe("Approved: Checkout clean at Villa Azul");
  expect(buildCopy("SUBMITTED", { ...c, worker: "Wendy" }).title).toBe("Wendy submitted Checkout clean at Villa Azul");
});
