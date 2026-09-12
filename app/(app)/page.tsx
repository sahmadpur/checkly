import Link from "next/link";
import { requireUser, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { listProperties } from "@/lib/services/property";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const properties = await listProperties(ctx);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Properties</h1>
        {roleAtLeast(role, "MANAGER") && <Button render={<Link href="/properties/new" />}>New property</Button>}
      </div>
      {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {properties.map((p) => (
          <Link key={p.id} href={`/properties/${p.id}`}>
            <Card className="h-full hover:bg-accent/40">
              <CardHeader><CardTitle className="text-base">{p.name}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {p.address ?? "No address"} · {p.memberCount} member{p.memberCount === 1 ? "" : "s"}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
