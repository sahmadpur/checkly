import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guard";
import { listOrgsForUser } from "@/lib/services/org";
import { unreadCount } from "@/lib/services/notification";
import { AppNav } from "@/components/app-nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { InstallBanner } from "@/components/install-banner";
import { NotificationBell } from "@/components/notification-bell";
import { Mark } from "@/components/brand";

const ROLE_LABEL = { OWNER: "Owner", MANAGER: "Manager", WORKER: "Worker" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await requireSignedIn();
  const orgs = await listOrgsForUser(userId);
  const active = orgs.find((o) => o.id === orgId);
  if (!active) redirect(orgs[0] ? `/switch-org?to=${orgs[0].id}` : "/no-org");
  const unread = await unreadCount({ userId, orgId: active.id });
  return (
    <div className="flex min-h-dvh">
      <AppNav role={active.role} />
      <div className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Mark className="size-7 md:hidden" />
            <OrgSwitcher orgs={orgs} activeOrgId={active.id} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{ROLE_LABEL[active.role]}</span>
            <NotificationBell unread={unread} />
          </div>
        </header>
        <InstallBanner />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
