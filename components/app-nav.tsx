"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ClipboardList, LayoutTemplate, LogOut, Settings, Sun, Users, type LucideIcon } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { Role } from "@prisma/client";
import { Wordmark } from "@/components/brand";
import { cn } from "cn";

type Item = { href: string; label: string; icon: LucideIcon };
const items = (role: Role): Item[] => [
  ...(role === "WORKER" ? [{ href: "/today", label: "Today", icon: Sun }] : []),
  { href: "/", label: "Properties", icon: Building2 },
  ...(role !== "WORKER" ? [{ href: "/checklists", label: "Checklists", icon: ClipboardList }, { href: "/templates", label: "Templates", icon: LayoutTemplate }, { href: "/team", label: "Team", icon: Users }] : []),
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({ role }: { role: Role }) {
  const path = usePathname();
  const links = items(role);
  const hasChecklists = links.some((l) => l.href === "/checklists");
  const isActive = (href: string) =>
    href === "/" ? path === "/" || path.startsWith("/properties") || path.startsWith("/schedules") || (!hasChecklists && path.startsWith("/checklists")) : path.startsWith(href);
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r bg-sidebar p-4 md:flex">
        <Link href={role === "WORKER" ? "/today" : "/"} className="mb-6 px-2"><Wordmark /></Link>
        {links.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <Icon className="size-5" aria-hidden /> {label}
            </Link>
          );
        })}
        <form action={logoutAction} className="mt-auto">
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="size-5" aria-hidden /> Sign out</button>
        </form>
      </aside>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card/95 px-2 pt-1 pb-safe backdrop-blur md:hidden">
        {links.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
              <Icon className={cn("size-6", active && "fill-primary/15")} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
