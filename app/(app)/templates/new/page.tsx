import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { TemplateBuilder } from "../template-builder";

export default async function NewTemplatePage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="New template" back={{ href: "/templates", label: "Templates" }} />
      <TemplateBuilder />
    </div>
  );
}
