import { requireUser } from "@/lib/auth/guard";
import { listMine } from "@/lib/services/notification";
import { formatDateTime } from "@/lib/format";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  const ctx = await requireUser();
  const rows = await listMine(ctx);
  return <NotificationList rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null, createdLabel: formatDateTime(r.createdAt) }))} />;
}
