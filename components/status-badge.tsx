import type { InstanceStatus } from "@prisma/client";

type Key = InstanceStatus | "OVERDUE";
const STYLES: Record<Key, string> = {
  OPEN: "bg-muted text-foreground",
  OVERDUE: "bg-destructive/10 text-destructive",
  SUBMITTED: "bg-info/10 text-info-foreground",
  APPROVED: "bg-success/10 text-success-foreground",
  REJECTED: "bg-warning/15 text-warning-foreground",
};
/** Left-edge stripe colour for list rows, matching the badge. Open rows get no stripe: nothing to shout about. */
export const STATUS_RAIL: Record<Key, string | undefined> = {
  OPEN: undefined,
  OVERDUE: "bg-destructive",
  SUBMITTED: "bg-info",
  APPROVED: "bg-success",
  REJECTED: "bg-warning",
};
const LABELS: Record<Key, string> = { OPEN: "Open", OVERDUE: "Overdue", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Needs rework" };

export const statusKey = (status: InstanceStatus, overdue: boolean): Key => (overdue ? "OVERDUE" : status);

export function StatusBadge({ status, overdue }: { status: InstanceStatus; overdue: boolean }) {
  const key = statusKey(status, overdue);
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[key]}`}>{LABELS[key]}</span>;
}
