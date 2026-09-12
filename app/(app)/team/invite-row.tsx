"use client";
import { useTransition } from "react";
import { revokeInviteAction } from "@/actions/invite";
import { Button } from "@/components/ui/button";

export function InviteRow({ invite }: { invite: { id: string; email: string; role: string; expiresAt: Date } }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between p-3 text-sm">
      <span>{invite.email} <span className="text-muted-foreground">· {invite.role.toLowerCase()} · expires {invite.expiresAt.toLocaleDateString()}</span></span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await revokeInviteAction(invite.id); })}>Revoke</Button>
    </li>
  );
}
