import { requireUser } from "@/lib/auth/guard";
import { listMine } from "@/lib/services/notification";
import { getLocale } from "next-intl/server";
import { formatDateTime } from "@/lib/format";
import { renderStored } from "@/lib/notifications/copy";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  const ctx = await requireUser();
  const locale = await getLocale();
  const rows = await listMine(ctx);
  return <NotificationList rows={rows.map((r) => ({ ...r, ...renderStored(r, locale), createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null, createdLabel: formatDateTime(r.createdAt, locale) }))} />;
}
