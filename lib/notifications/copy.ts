import type { NotificationType } from "@prisma/client";
import { formatInTz } from "@/lib/format";

export type CopyCtx = { template: string; property: string; dueAt: Date; tz: string; comment?: string | null; worker?: string; instanceId: string };

export function buildCopy(type: NotificationType, c: CopyCtx): { title: string; body: string; url: string } {
  const where = `${c.template} at ${c.property}`;
  const due = `Due ${formatInTz(c.dueAt, c.tz)}`;
  const url = `/checklists/${c.instanceId}`;
  switch (type) {
    case "ASSIGNED": return { title: `New checklist: ${where}`, body: due, url };
    case "DUE_SOON": return { title: `Due in 1 hour: ${where}`, body: due, url };
    case "OVERDUE": return { title: `Overdue: ${where}`, body: due, url };
    case "REJECTED": return { title: `Needs rework: ${where}`, body: c.comment ?? "", url };
    case "APPROVED": return { title: `Approved: ${where}`, body: due, url };
    case "SUBMITTED": return { title: `${c.worker ?? "A worker"} submitted ${where}`, body: due, url };
  }
}
