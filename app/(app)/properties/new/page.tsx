import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { PropertyForm } from "./property-form";

export default async function NewPropertyPage() {
  await requireOrgRole(await requireUser(), "MANAGER");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New property</h1>
      <PropertyForm />
    </div>
  );
}
