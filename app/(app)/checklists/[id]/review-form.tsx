"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { reviewChecklistAction } from "@/actions/instance";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/form-error";
import { Section } from "@/components/section";

export function ReviewForm({ instanceId }: { instanceId: string }) {
  const t = useTranslations("checklists.review");
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
    <Section title={t("title")} description={t("description")} card>
      <div className="space-y-3">
        <Textarea aria-label={t("commentLabel")} rows={3} placeholder={t("commentPlaceholder")} value={comment} onChange={(e) => setComment(e.target.value)} />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => decide("APPROVED")}>{t("approve")}</Button>
          <Button variant="destructive" disabled={pending} onClick={() => decide("REJECTED")}>{t("reject")}</Button>
        </div>
      </div>
    </Section>
  );
}
