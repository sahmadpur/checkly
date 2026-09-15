import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { PropertyForm } from "./property-form";

export default async function NewPropertyPage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="New property" back={{ href: "/", label: "Properties" }} />
      <div className="rounded-xl bg-card p-4 ring-1 ring-border sm:p-5"><PropertyForm /></div>
    </div>
  );
}
