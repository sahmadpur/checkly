import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { archiveTemplate, createTemplate, getTemplate, listTemplates, updateTemplate, ItemInput } from "@/lib/services/template";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";

const item = (p: Partial<ItemInput> & Pick<ItemInput, "type" | "label">): ItemInput =>
  ({ required: true, options: [], min: null, max: null, ...p });

async function setup() {
  const org = await makeOrg();
  const mgr = await makeUser();
  const worker = await makeUser();
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, worker.id, "WORKER");
  return { org, ctx: { userId: mgr.id, orgId: org.id }, wctx: { userId: worker.id, orgId: org.id } };
}

describe("templates", () => {
  test("create, get, list; worker forbidden", async () => {
    const { ctx, wctx } = await setup();
    const { id } = await createTemplate(ctx, {
      name: "Clean", items: [item({ type: "CHECKBOX", label: "Beds" }), item({ type: "SELECT", label: "State", options: ["Good", "Bad"] })],
    });
    const t = await getTemplate(ctx, id);
    expect(t.items.map((i) => [i.order, i.type, i.label])).toEqual([[0, "CHECKBOX", "Beds"], [1, "SELECT", "State"]]);
    expect((await listTemplates(ctx)).map((t) => [t.name, t.itemCount])).toEqual([["Clean", 2]]);
    await expect(listTemplates(wctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("update replaces items wholesale", async () => {
    const { ctx } = await setup();
    const { id } = await createTemplate(ctx, { name: "A", items: [item({ type: "CHECKBOX", label: "One" }), item({ type: "TEXT", label: "Two" })] });
    await updateTemplate(ctx, id, { name: "B", items: [item({ type: "NUMBER", label: "Count", min: 0, max: 5 })] });
    const t = await getTemplate(ctx, id);
    expect(t.name).toBe("B");
    expect(t.items.map((i) => i.label)).toEqual(["Count"]);
    expect(await db.templateItem.count({ where: { templateId: id } })).toBe(1);
  });

  test("validation: empty items, bad select, bad number range", async () => {
    const { ctx } = await setup();
    await expect(createTemplate(ctx, { name: "X", items: [] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "SELECT", label: "S", options: ["only"] })] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "SELECT", label: "S", options: ["a", "a"] })] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "NUMBER", label: "N", min: 5, max: 1 })] })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("archive hides from default list; cross-org is NOT_FOUND", async () => {
    const { ctx } = await setup();
    const other = await setup();
    const { id } = await createTemplate(ctx, { name: "A", items: [item({ type: "CHECKBOX", label: "One" })] });
    await archiveTemplate(ctx, id);
    expect(await listTemplates(ctx)).toEqual([]);
    expect((await listTemplates(ctx, { includeArchived: true })).length).toBe(1);
    await expect(getTemplate(other.ctx, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(archiveTemplate(other.ctx, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
