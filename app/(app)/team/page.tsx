import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { listMembers } from "@/lib/services/member";
import { listInvites } from "@/lib/services/invite";
import { listProperties } from "@/lib/services/property";
import { AppError } from "@/lib/errors";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
import { InviteRow } from "./invite-row";

export default async function TeamPage() {
  const ctx = await requireUser();
  let role;
  try {
    role = await requireOrgRole(ctx, "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") {
      return <div className="p-6 text-sm"><p className="font-medium">You don&apos;t have access to this page.</p></div>;
    }
    throw e;
  }
  const [members, invites, properties] = await Promise.all([listMembers(ctx), listInvites(ctx), listProperties(ctx)]);
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Team</h1>
      <ul className="divide-y rounded-md border">
        {members.map((m) => (
          <MemberRow key={m.userId} isOwner={role === "OWNER"} isSelf={m.userId === ctx.userId}
            member={{ ...m, propertyCount: m.propertyIds.length }} />
        ))}
      </ul>
      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-md border">{invites.map((i) => <InviteRow key={i.id} invite={i} />)}</ul>
        </section>
      )}
      <InviteForm properties={properties} canInviteOwner={role === "OWNER"} />
    </div>
  );
}
