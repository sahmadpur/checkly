import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Forbidden() {
  return (
    <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
      <p className="text-lg font-semibold">You don&apos;t have access to this page.</p>
      <p className="text-sm text-muted-foreground">Ask an owner or manager if you think you should.</p>
      <Button variant="outline" render={<Link href="/" />}>Back to properties</Button>
    </div>
  );
}
