import { expect, test } from "vitest";
import { templateSchema } from "@/actions/template.schemas";
import { answerSchema, assignSchema, uploadRequestSchema } from "@/actions/instance.schemas";

test("template schema coerces item fields", () => {
  const r = templateSchema.safeParse({ name: " A ", items: [{ type: "NUMBER", label: "N", required: true, options: [], min: "1", max: null }] });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.items[0].min).toBe(1);
  const empty = templateSchema.safeParse({ name: "A", items: [{ type: "NUMBER", label: "N", required: true, options: [], min: "", max: "" }] });
  expect(empty.success).toBe(true);
  if (empty.success) expect([empty.data.items[0].min, empty.data.items[0].max]).toEqual([null, null]);
  const absent = templateSchema.safeParse({ name: "A", items: [{ type: "TEXT", label: "T", required: true, options: [] }] });
  expect(absent.success && absent.data.items[0].min).toBe(null);
  expect(templateSchema.safeParse({ name: "", items: [] }).success).toBe(false);
});

test("assign schema parses ISO dueAt into a Date", () => {
  const r = assignSchema.safeParse({ templateId: "t", propertyId: "p", assigneeIds: ["u"], dueAt: "2026-09-20T10:00:00.000Z" });
  expect(r.success && r.data.dueAt instanceof Date).toBe(true);
  expect(assignSchema.safeParse({ templateId: "t", propertyId: "p", assigneeIds: [], dueAt: "x" }).success).toBe(false);
});

test("answer schema is a discriminated union", () => {
  expect(answerSchema.safeParse({ type: "CHECKBOX", checked: true }).success).toBe(true);
  expect(answerSchema.safeParse({ type: "NUMBER", number: "3" }).success).toBe(false);
  expect(answerSchema.safeParse({ type: "PHOTO", fileKey: "k", fileType: "image/jpeg" }).success).toBe(true);
  expect(answerSchema.safeParse({ type: "SELECT" }).success).toBe(false);
});

test("upload request bounds", () => {
  expect(uploadRequestSchema.safeParse({ instanceId: "i", itemId: "t", contentType: "image/jpeg", sizeBytes: 100 }).success).toBe(true);
  expect(uploadRequestSchema.safeParse({ instanceId: "i", itemId: "t", contentType: "image/jpeg", sizeBytes: 0 }).success).toBe(false);
});
