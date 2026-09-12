import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { PropertyForm } from "./property-form";

export default async function NewPropertyPage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") {
      return <div className="p-6 text-sm"><p className="font-medium">You don&apos;t have access to this page.</p></div>;
    }
    throw e;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New property</h1>
      <PropertyForm />
    </div>
  );
}
