"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/actions/auth";
import { Role } from "@prisma/client";

const items = (role: Role) => [
  { href: "/", label: "Properties" },
  ...(role !== "WORKER" ? [{ href: "/team", label: "Team" }] : []),
  { href: "/settings", label: "Settings" },
];

export function AppNav({ role }: { role: Role }) {
  const path = usePathname();
  const links = items(role).map((i) => {
    const active = i.href === "/" ? path === "/" || path.startsWith("/properties") : path.startsWith(i.href);
    return (
      <Link key={i.href} href={i.href}
        className={`rounded-md px-3 py-2 text-sm ${active ? "bg-accent font-medium" : "text-muted-foreground"}`}>
        {i.label}
      </Link>
    );
  });
  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r p-3 md:flex">
        <div className="mb-3 px-3 text-lg font-semibold">Checkly</div>
        {links}
        <form action={logoutAction} className="mt-auto"><button className="px-3 py-2 text-sm text-muted-foreground">Sign out</button></form>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {links}
      </nav>
    </>
  );
}
