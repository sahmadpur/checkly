import type { InstanceStatus } from "@prisma/client";

const STYLES: Record<InstanceStatus | "OVERDUE", string> = {
  OPEN: "bg-muted text-foreground",
  OVERDUE: "bg-destructive/15 text-destructive",
  SUBMITTED: "bg-blue-100 text-blue-900",
  APPROVED: "bg-green-100 text-green-900",
  REJECTED: "bg-amber-100 text-amber-900",
};
const LABELS: Record<InstanceStatus | "OVERDUE", string> = { OPEN: "Open", OVERDUE: "Overdue", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Needs rework" };

export function StatusBadge({ status, overdue }: { status: InstanceStatus; overdue: boolean }) {
  const key = overdue ? "OVERDUE" : status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>{LABELS[key]}</span>;
}
