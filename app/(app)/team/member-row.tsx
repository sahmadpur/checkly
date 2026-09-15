"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Role } from "@prisma/client";
import { changeRoleAction, removeMemberAction } from "@/actions/member";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { ListRow } from "@/components/ui/list";

export function MemberRow({ member, isOwner, isSelf }: {
  member: { userId: string; name: string; email: string | null; phone: string | null; role: Role; propertyCount: number };
  isOwner: boolean; isSelf: boolean;
}) {
  const t = useTranslations("team.memberRow");
  const te = useTranslations("enums");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ListRow>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{member.name}{isSelf && <span className="font-normal text-muted-foreground"> {t("you")}</span>}</div>
        <div className="truncate text-muted-foreground">{member.email ?? member.phone} · {t("properties", { count: member.propertyCount })}</div>
        <FormError message={error} />
      </div>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <Select aria-label={t("roleFor", { name: member.name })} className="w-32 [&>select]:h-9" value={member.role} disabled={pending}
            onChange={(e) => start(async () => { const r = await changeRoleAction(member.userId, e.target.value); if (!r.ok) setError(r.error); })}>
            <option value="OWNER">{te("role.OWNER")}</option><option value="MANAGER">{te("role.MANAGER")}</option><option value="WORKER">{te("role.WORKER")}</option>
          </Select>
        ) : <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">{te(`role.${member.role}`)}</span>}
        {isOwner && !isSelf && (
          <Button variant="ghost" size="sm" disabled={pending}
            onClick={() => { if (confirm(t("removeConfirm", { name: member.name }))) start(async () => { const r = await removeMemberAction(member.userId); if (!r.ok) setError(r.error); }); }}>
            {t("remove")}
          </Button>
        )}
      </div>
    </ListRow>
  );
}
