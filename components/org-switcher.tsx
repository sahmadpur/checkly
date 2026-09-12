"use client";
import { useTransition } from "react";
import { switchOrgAction } from "@/actions/org";

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: { id: string; name: string }[]; activeOrgId: string }) {
  const [pending, start] = useTransition();
  if (orgs.length <= 1) return <span className="font-medium">{orgs[0]?.name}</span>;
  return (
    <select
      aria-label="Organization"
      className="rounded-md border bg-background px-2 py-1 text-sm"
      value={activeOrgId}
      disabled={pending}
      onChange={(e) => start(async () => { await switchOrgAction({ orgId: e.target.value }); })}
    >
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
