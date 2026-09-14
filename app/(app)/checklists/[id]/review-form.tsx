"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewChecklistAction } from "@/actions/instance";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ReviewForm({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "APPROVED" | "REJECTED") =>
    start(async () => {
      const r = await reviewChecklistAction(instanceId, { decision, comment });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  return (
    <section className="space-y-2 rounded-md border p-4">
      <h2 className="font-medium">Review</h2>
      <textarea aria-label="Review comment" className="w-full rounded-md border bg-background p-2 text-sm" rows={3}
        placeholder="Comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide("APPROVED")}>Approve</Button>
        <Button variant="destructive" disabled={pending} onClick={() => decide("REJECTED")}>Reject</Button>
      </div>
    </section>
  );
}
