"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewChecklistAction } from "@/actions/instance";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/form-error";
import { Section } from "@/components/section";

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
    <Section title="Review" description="Rejecting sends it back to the same worker with your comment." card>
      <div className="space-y-3">
        <Textarea aria-label="Review comment" rows={3} placeholder="Comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => decide("APPROVED")}>Approve</Button>
          <Button variant="destructive" disabled={pending} onClick={() => decide("REJECTED")}>Reject</Button>
        </div>
      </div>
    </Section>
  );
}
