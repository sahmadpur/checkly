import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guard";
import { listOrgsForUser } from "@/lib/services/org";
import { AppNav } from "@/components/app-nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { InstallBanner } from "@/components/install-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await requireSignedIn();
  const orgs = await listOrgsForUser(userId);
  const active = orgs.find((o) => o.id === orgId);
  if (!active) redirect(orgs[0] ? `/switch-org?to=${orgs[0].id}` : "/no-org");
  return (
    <div className="flex min-h-dvh">
      <AppNav role={active.role} />
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <OrgSwitcher orgs={orgs} activeOrgId={active.id} />
          <span className="text-xs uppercase text-muted-foreground">{active.role}</span>
        </header>
        <InstallBanner />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
