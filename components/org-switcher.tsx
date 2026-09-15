"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { switchOrgAction } from "@/actions/org";
import { Select } from "@/components/ui/select";

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: { id: string; name: string }[]; activeOrgId: string }) {
  const t = useTranslations("nav");
  const [pending, start] = useTransition();
  if (orgs.length <= 1) return <span className="truncate font-heading text-base font-semibold">{orgs[0]?.name}</span>;
  return (
    <Select
      aria-label={t("organization")}
      className="max-w-56 [&>select]:h-9 [&>select]:font-medium"
      value={activeOrgId}
      disabled={pending}
      onChange={(e) => start(async () => { await switchOrgAction({ orgId: e.target.value }); })}
    >
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </Select>
  );
}
