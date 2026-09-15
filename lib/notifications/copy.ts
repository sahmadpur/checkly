import type { NotificationType } from "@prisma/client";
import { formatInTz } from "@/lib/format";
import { translatorFor } from "@/lib/i18n";

/** Stored on Notification.params; rendered per viewer/recipient at read or send time. */
export type CopyParams = { template: string; property: string; dueAt: string; tz: string; comment?: string | null; worker?: string };

export const copyParams = (c: { template: string; property: string; dueAt: Date; tz: string; comment?: string | null; worker?: string }): CopyParams =>
  ({ template: c.template, property: c.property, dueAt: c.dueAt.toISOString(), tz: c.tz, ...(c.comment != null && { comment: c.comment }), ...(c.worker && { worker: c.worker }) });

export function renderCopy(type: NotificationType, p: CopyParams, locale: string): { title: string; body: string } {
  const t = translatorFor(locale, "notifications.copy");
  const where = t("where", { template: p.template, property: p.property });
  const due = t("due", { when: formatInTz(new Date(p.dueAt), p.tz, locale) });
  switch (type) {
    case "REJECTED": return { title: t(type, { where }), body: p.comment ?? "" };
    case "SUBMITTED": return { title: t(type, { where, worker: p.worker ?? t("aWorker") }), body: due };
    default: return { title: t(type, { where }), body: due };
  }
}

/** Title/body for a stored row: new rows carry params, rows from before i18n carry rendered text. */
export const renderStored = (n: { type: NotificationType; title: string | null; body: string | null; params: unknown }, locale: string) =>
  n.params ? renderCopy(n.type, n.params as CopyParams, locale) : { title: n.title ?? "", body: n.body ?? "" };
