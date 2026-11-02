/** Image rules shared by the upload UI and the server (dev doc §3.8). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Extensions as the magic-byte sniffer names them; the stored file keeps this extension. */
export const IMAGE_ALLOWED_EXTS = [
  "png",
  "jpg",
  "tif",
  "webp",
  "dng",
  "cr2",
  "cr3",
  "nef",
  "arw",
  "raf",
  "orf",
  "rw2",
] as const;
export type ImageExt = (typeof IMAGE_ALLOWED_EXTS)[number];

/** Types browsers render inline; everything else is offered as a download (§3.8 caveat, D8). */
export const BROWSER_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function isBrowserRenderable(mime: string): boolean {
  return BROWSER_IMAGE_MIMES.has(mime);
}

/** Where a stored image is served from (§7). Stored names are random, so the URL is immutable. */
export function imageUrl(storedName: string): string {
  return `/api/images/${storedName}`;
}

/** What the file picker should accept: extensions, since RAW types have no stable MIME. */
export const IMAGE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".webp",
  ".dng",
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".raf",
  ".orf",
  ".rw2",
].join(",");
