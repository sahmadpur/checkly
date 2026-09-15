import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { listMembers } from "@/lib/services/member";
import { listInvites } from "@/lib/services/invite";
import { listProperties } from "@/lib/services/property";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { List } from "@/components/ui/list";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
import { InviteRow } from "./invite-row";
import { getTranslations } from "next-intl/server";

export default async function TeamPage() {
  const ctx = await requireUser();
  let role;
  try {
    role = await requireOrgRole(ctx, "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  const [members, invites, properties, t] = await Promise.all([listMembers(ctx), listInvites(ctx), listProperties(ctx), getTranslations("team")]);
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("memberCount", { count: members.length })} />
      <Section title={t("members")}>
        <List>
          {members.map((m) => (
            <MemberRow key={m.userId} isOwner={role === "OWNER"} isSelf={m.userId === ctx.userId}
              member={{ ...m, propertyCount: m.propertyIds.length }} />
          ))}
        </List>
      </Section>
      {invites.length > 0 && (
        <Section title={t("pending")}>
          <List>{invites.map((i) => <InviteRow key={i.id} invite={i} />)}</List>
        </Section>
      )}
      <InviteForm properties={properties} canInviteOwner={role === "OWNER"} />
    </div>
  );
}
