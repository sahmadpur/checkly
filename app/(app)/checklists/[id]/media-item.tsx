"use client";
import { useState } from "react";
import { answerItemAction, requestUploadAction } from "@/actions/instance";
import { mediaRule } from "@/lib/media";
import { resizeImage } from "@/lib/client/resize-image";
import { uploadWithProgress } from "@/lib/client/upload";
import { FormError } from "@/components/form-error";

type Props = { instanceId: string; itemId: string; type: "PHOTO" | "VIDEO"; existingUrl?: string; onSaved: () => void };

export function MediaItem({ instanceId, itemId, type, existingUrl, onSaved }: Props) {
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
      if (!rule.types.includes(contentType)) throw new Error(`Unsupported file type ${contentType || "(unknown)"}`);
      if (blob.size > rule.maxBytes) throw new Error(`File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`);
      setProgress(0);
      const req = await requestUploadAction({ instanceId, itemId, contentType, sizeBytes: blob.size });
      if (!req.ok) throw new Error(req.error);
      await uploadWithProgress(req.data.url, blob, contentType, setProgress);
      const saved = await answerItemAction(instanceId, itemId, { type, fileKey: req.data.key, fileType: contentType });
      if (!saved.ok) throw new Error(saved.error);
      setPreview(URL.createObjectURL(blob));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2">
      {preview && (type === "PHOTO"
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview} alt="" className="max-h-64 rounded-md" />
        : <video controls playsInline src={preview} className="max-h-64 w-full rounded-md" />)}
      <label className="block">
        <span className="sr-only">{type === "PHOTO" ? "Take photo" : "Record video"}</span>
        <input type="file" accept={type === "PHOTO" ? "image/*" : "video/*"} capture="environment" disabled={progress !== null}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground" />
      </label>
      {progress !== null && <progress className="w-full" value={progress} max={100}>{progress}%</progress>}
      <FormError message={error} />
    </div>
  );
}
