import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function NotificationBell({ unread }: { unread: number }) {
  const t = await getTranslations("nav");
  const label = unread > 99 ? "99+" : String(unread);
  return (
    <Link href="/notifications" aria-label={t("notifications", { count: unread })}
      className="relative inline-flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-muted">
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white">{label}</span>
      )}
    </Link>
  );
}
