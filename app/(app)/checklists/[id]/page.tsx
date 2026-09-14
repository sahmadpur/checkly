import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getInstance } from "@/lib/services/instance";
import { presignDownload, storageConfigured } from "@/lib/storage";
import { AppError } from "@/lib/errors";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { AnswerView } from "./answer-view";
import { ReviewForm } from "./review-form";
import { FillForm } from "./fill-form";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let inst;
  try {
    inst = await getInstance(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const mediaUrls: Record<string, string> = {};
  // A plain <a download> cannot rename a cross-origin file, so videos get a second URL that forces the save.
  const downloadUrls: Record<string, string> = {};
  if (storageConfigured()) {
    for (const i of inst.items) {
      if (!i.fileKey) continue;
      mediaUrls[i.id] = await presignDownload(i.fileKey);
      if (i.type === "VIDEO") downloadUrls[i.id] = await presignDownload(i.fileKey, 900, { attachment: true });
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground"><Link href={`/properties/${inst.propertyId}`} className="underline">{inst.propertyName}</Link> · {inst.assigneeName}</p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">{inst.templateName} <StatusBadge status={inst.status} overdue={inst.overdue} /></h1>
        <p className="text-sm text-muted-foreground">Due <LocalTime iso={inst.dueAt.toISOString()} fallback={formatDateTime(inst.dueAt)} /></p>
        {inst.scheduleName && <p className="text-sm text-muted-foreground">From schedule: {inst.scheduleName}</p>}
      </div>
      {inst.status === "REJECTED" && inst.reviewComment && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Needs rework{inst.reviewedByName ? ` · ${inst.reviewedByName}` : ""}</p>
          <p className="whitespace-pre-wrap">{inst.reviewComment}</p>
        </div>
      )}
      {inst.status === "APPROVED" && inst.reviewComment && <p className="text-sm text-muted-foreground">Reviewer note: {inst.reviewComment}</p>}
      {inst.canFill ? <FillForm instance={inst} mediaUrls={mediaUrls} /> : <AnswerView items={inst.items} mediaUrls={mediaUrls} downloadUrls={downloadUrls} />}
      {inst.canReview && <ReviewForm instanceId={inst.id} />}
    </div>
  );
}
