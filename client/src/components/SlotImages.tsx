import {
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  type Image,
  imageUrl,
  isBrowserRenderable,
  type Slot,
} from "@production-line/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError, api } from "../lib/api.ts";
import { useMeta } from "../lib/auth.tsx";
import { slotsQueryKey } from "../lib/data.ts";
import { formatBytes, uploadFile } from "../lib/upload.ts";
import { secondaryButtonClass } from "./Field.tsx";
import { CloseIcon, DownloadIcon, ImageIcon } from "./Icons.tsx";
import { errorNoticeClass } from "./Notice.tsx";

interface Upload {
  key: number;
  name: string;
  fraction: number;
  error: string | null;
}

const UPLOAD_ERRORS: Record<string, string> = {
  image_type_not_allowed: "Not a supported image (PNG, JPEG, TIFF, WEBP, or camera RAW).",
  image_too_large: "Larger than 10 MB.",
  images_disabled: "Image uploads are turned off.",
};

/**
 * The editor's image section (dev doc §3.8, §11.2): thumbnails for what browsers can show, file
 * cards with a download link for TIFF/RAW, multi-file upload with per-file progress, and delete
 * under the slot access rule. The upload control only appears while images are enabled; existing
 * images stay visible either way.
 */
export function SlotImages({ slot, canEdit }: { slot: Slot; canEdit: boolean }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const enabled = meta.data?.images_enabled ?? false;
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const applySlot = (updated: Slot) => {
    qc.setQueryData(slotsQueryKey.one(updated.id), updated);
    void qc.invalidateQueries({ queryKey: slotsQueryKey.all });
  };

  const patch = (key: number, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const key = nextKey.current++;
      setUploads((list) => [...list, { key, name: file.name, fraction: 0, error: null }]);
      if (file.size > IMAGE_MAX_BYTES) {
        patch(key, { error: UPLOAD_ERRORS.image_too_large ?? "Too large." });
        continue;
      }
      try {
        const updated = await uploadFile<Slot>(`/api/slots/${slot.id}/images`, "POST", file, {
          onProgress: (fraction) => patch(key, { fraction }),
        });
        applySlot(updated);
        setUploads((list) => list.filter((u) => u.key !== key));
      } catch (err) {
        const code = err instanceof ApiError ? err.code : "error";
        patch(key, {
          error: UPLOAD_ERRORS[code] ?? (err instanceof Error ? err.message : "Upload failed."),
        });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = async (image: Image) => {
    setRemoveError(null);
    setRemoving(image.id);
    try {
      await api<void>(`/api/slots/${slot.id}/images/${image.id}`, { method: "DELETE" });
      applySlot({ ...slot, images: slot.images.filter((i) => i.id !== image.id) });
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Could not remove the image.");
    } finally {
      setRemoving(null);
    }
  };

  if (!enabled && slot.images.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="slot-images-title"
      data-testid="slot-images"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="slot-images-title" className="font-medium text-sm">
          Images
        </h3>
        {enabled && canEdit ? (
          <>
            <input
              ref={inputRef}
              id="slot-image-input"
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              className="sr-only"
              onChange={(e) => void onFiles(e.target.files)}
              data-testid="image-upload"
            />
            <label
              htmlFor="slot-image-input"
              className={`${secondaryButtonClass} ml-auto cursor-pointer`}
            >
              <ImageIcon size={18} />
              Add images
            </label>
          </>
        ) : null}
      </div>
      {enabled && canEdit ? (
        <p className="text-ink-muted text-xs">
          PNG, JPEG, TIFF, WEBP, or camera RAW up to 10 MB each. TIFF and RAW are kept as downloads.
        </p>
      ) : null}
      {slot.images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="image-gallery">
          {slot.images.map((image) => (
            <li key={image.id} className="relative">
              {isBrowserRenderable(image.mime) ? (
                <a
                  href={imageUrl(image.stored_name)}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-line"
                  title={`${image.original_name} · ${formatBytes(image.bytes)}`}
                  data-testid="image-thumb"
                >
                  <img
                    src={imageUrl(image.stored_name)}
                    alt={image.original_name}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </a>
              ) : (
                <a
                  href={imageUrl(image.stored_name)}
                  download={image.original_name}
                  className="flex aspect-square flex-col justify-between rounded-lg border border-line bg-canvas/50 p-2 text-xs hover:bg-accent-soft"
                  title={`Download ${image.original_name}`}
                  data-testid="image-card"
                >
                  <span className="flex items-center gap-1 text-ink-muted">
                    <DownloadIcon size={16} />
                    {image.mime.replace(/^image\/(x-)?/, "").toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{image.original_name}</span>
                    <span className="text-ink-muted">{formatBytes(image.bytes)} · download</span>
                  </span>
                </a>
              )}
              {canEdit ? (
                <button
                  type="button"
                  className="absolute top-1 right-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-canvas/80 text-ink hover:bg-danger-soft lg:min-h-8 lg:min-w-8"
                  onClick={() => void remove(image)}
                  disabled={removing === image.id}
                  aria-label={`Remove ${image.original_name}`}
                  title="Remove"
                >
                  <CloseIcon size={16} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {uploads.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="upload-list">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="flex items-center gap-2 text-xs"
              data-testid="upload-progress"
            >
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.error ? (
                <>
                  <span className="text-danger">{u.error}</span>
                  <button
                    type="button"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg lg:min-h-8 lg:min-w-8"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                    aria-label={`Dismiss ${u.name}`}
                  >
                    <CloseIcon size={14} />
                  </button>
                </>
              ) : (
                <progress
                  className="h-2 w-32 accent-accent"
                  value={u.fraction}
                  max={1}
                  aria-label={`Uploading ${u.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {removeError ? (
        <p className={errorNoticeClass} role="alert">
          {removeError}
        </p>
      ) : null}
    </section>
  );
}
