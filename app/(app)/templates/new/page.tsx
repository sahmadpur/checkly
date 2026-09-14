import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { TemplateBuilder } from "../template-builder";

export default async function NewTemplatePage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New template</h1>
      <TemplateBuilder />
    </div>
  );
}
