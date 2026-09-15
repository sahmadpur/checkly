"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { answerItemAction, requestUploadAction } from "@/actions/instance";
import { mediaRule } from "@/lib/media";
import { resizeImage } from "@/lib/client/resize-image";
import { uploadWithProgress } from "@/lib/client/upload";
import { FormError } from "@/components/form-error";
import { Camera, Video } from "lucide-react";
import { cn } from "cn";

type Props = { instanceId: string; itemId: string; type: "PHOTO" | "VIDEO"; existingUrl?: string; onSaved: () => void };

export function MediaItem({ instanceId, itemId, type, existingUrl, onSaved }: Props) {
  const t = useTranslations("checklists.media");
  const [preview, setPreview] = useState<string | undefined>(existingUrl);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rule = mediaRule(type);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const blob = type === "PHOTO" ? await resizeImage(file) : file;
      const contentType = blob.type || file.type;
      if (!rule.types.includes(contentType)) throw new Error(t("unsupportedType", { type: contentType || t("unknownType") }));
      if (blob.size > rule.maxBytes) throw new Error(t("tooLarge", { mb: Math.round(rule.maxBytes / 1024 / 1024) }));
      setProgress(0);
      const req = await requestUploadAction({ instanceId, itemId, contentType, sizeBytes: blob.size });
      if (!req.ok) throw new Error(req.error);
      await uploadWithProgress(req.data.url, blob, contentType, setProgress);
      const saved = await answerItemAction(instanceId, itemId, { type, fileKey: req.data.key, fileType: contentType });
      if (!saved.ok) throw new Error(saved.error);
      setPreview(URL.createObjectURL(blob));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("uploadFailed"));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2">
      {preview && (type === "PHOTO"
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview} alt="" className="max-h-64 rounded-lg" />
        : <video controls playsInline src={preview} className="max-h-64 w-full rounded-lg bg-black" />)}
      <label className={cn("flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input text-sm font-medium hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50", progress !== null && "pointer-events-none opacity-60")}>
        {type === "PHOTO" ? <Camera className="size-5" aria-hidden /> : <Video className="size-5" aria-hidden />}
        {progress !== null ? t("uploading", { percent: progress }) : preview ? (type === "PHOTO" ? t("retakePhoto") : t("recordAgain")) : (type === "PHOTO" ? t("takePhoto") : t("recordVideo"))}
        <input type="file" accept={type === "PHOTO" ? "image/*" : "video/*"} capture="environment" disabled={progress !== null}
          onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" />
      </label>
      {progress !== null && <progress value={progress} max={100}>{progress}%</progress>}
      <FormError message={error} />
    </div>
  );
}
