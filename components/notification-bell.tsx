import Link from "next/link";

export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 99 ? "99+" : String(unread);
  return (
    <Link href="/notifications" aria-label={`Notifications, ${unread} unread`} className="relative rounded-md px-2 py-1 text-sm">
      <span aria-hidden>🔔</span>
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-medium text-white">{label}</span>}
    </Link>
  );
}
