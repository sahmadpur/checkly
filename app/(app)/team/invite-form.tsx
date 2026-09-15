"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createInviteAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function InviteForm({ properties, canInviteOwner }: { properties: { id: string; name: string }[]; canInviteOwner: boolean }) {
  const t = useTranslations("team.invite");
  const te = useTranslations("enums");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title={t("title")} description={t("description")} card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          start(async () => {
            const res = await createInviteAction({
              email: String(fd.get("email")),
              role: String(fd.get("role")) as "OWNER" | "MANAGER" | "WORKER",
              propertyIds: fd.getAll("propertyIds").map(String),
            });
            if (!res.ok) { setError(res.error); setSent(false); } else { setError(null); setSent(true); form.reset(); }
          });
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1.5"><Label htmlFor="email">{t("email")}</Label><Input id="email" name="email" type="email" required autoComplete="off" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="role">{t("role")}</Label>
            <Select id="role" name="role" defaultValue="WORKER">
              <option value="WORKER">{te("role.WORKER")}</option>
              <option value="MANAGER">{te("role.MANAGER")}</option>
              {canInviteOwner && <option value="OWNER">{te("role.OWNER")}</option>}
            </Select>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t("properties")}</legend>
          {properties.length === 0 && <p className="text-sm text-muted-foreground">{t("noProperties")}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent/50">
                <input type="checkbox" name="propertyIds" value={p.id} /> {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <FormError message={error} />
        {sent && <FormSuccess message={t("sent")} />}
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </form>
    </Section>
  );
}
