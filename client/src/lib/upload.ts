import type { ApiErrorBody } from "@production-line/shared";
import { ApiError } from "./api.ts";

export interface UploadOptions {
  /** 0..1 as bytes leave the browser. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Multipart upload with progress. `fetch` can't report upload progress, so this is the one place
 * XMLHttpRequest is used. Errors become ApiError like everything else.
 */
export function uploadFile<T>(
  path: string,
  method: "POST" | "PUT",
  file: File,
  options: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) options.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        json = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve(json as T);
      } else {
        const body = (json as ApiErrorBody | null) ?? { error: `http_${xhr.status}` };
        reject(new ApiError(xhr.status, body));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, { error: "network", message: "The upload was interrupted." }));
    xhr.onabort = () =>
      reject(new ApiError(0, { error: "aborted", message: "The upload was cancelled." }));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

/** Human-readable size for file cards and limits. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
