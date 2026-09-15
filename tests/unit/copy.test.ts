import { expect, test } from "vitest";
import { copyParams, renderCopy } from "@/lib/notifications/copy";
import { formatInTz } from "@/lib/format";

const c = { template: "Checkout clean", property: "Villa Azul", dueAt: new Date("2026-03-02T08:00:00Z"), tz: "Europe/Madrid" };
const render = (type: Parameters<typeof renderCopy>[0], extra: Partial<Parameters<typeof copyParams>[0]> = {}, locale = "en") => renderCopy(type, copyParams({ ...c, ...extra }), locale);

test("formatInTz renders in the org timezone", () => {
  expect(formatInTz(c.dueAt, "Europe/Madrid")).toBe("Mon, Mar 2, 09:00");
  expect(formatInTz(c.dueAt, "UTC")).toBe("Mon, Mar 2, 08:00");
});

test("copy per type", () => {
  expect(render("ASSIGNED")).toEqual({ title: "New checklist: Checkout clean at Villa Azul", body: "Due Mon, Mar 2, 09:00" });
  expect(render("DUE_SOON").title).toBe("Due in 1 hour: Checkout clean at Villa Azul");
  expect(render("OVERDUE").title).toBe("Overdue: Checkout clean at Villa Azul");
  expect(render("REJECTED", { comment: "Redo beds" })).toEqual({ title: "Needs rework: Checkout clean at Villa Azul", body: "Redo beds" });
  expect(render("APPROVED").title).toBe("Approved: Checkout clean at Villa Azul");
  expect(render("SUBMITTED", { worker: "Wendy" }).title).toBe("Wendy submitted Checkout clean at Villa Azul");
  expect(render("SUBMITTED").title).toBe("A worker submitted Checkout clean at Villa Azul");
});

test("copy renders in the recipient locale", () => {
  expect(render("OVERDUE", {}, "ru").title).toBe("Просрочен: Checkout clean — Villa Azul");
  expect(render("ASSIGNED", {}, "az").body).toMatch(/^Son tarix: /);
});
