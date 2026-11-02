import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { IMAGE_ALLOWED_EXTS, IMAGE_MAX_BYTES, type Image } from "@production-line/shared";
import { fileTypeStream } from "file-type";
import type { Logger } from "pino";
import { HttpError } from "../errors.js";

const ALLOWED: ReadonlySet<string> = new Set(IMAGE_ALLOWED_EXTS);
/** Enough bytes for every signature in the allow-list (CR3's ftyp box, TIFF IFD tags). */
const SNIFF_BYTES = 4100;

export interface StoreImageInput {
  stream: Readable;
  originalName: string;
  uploaderId: number;
  /** Null for avatars. */
  slotId: number | null;
}

/**
 * Image storage (dev doc §3.8, §9.7): files are sniffed by magic bytes while streaming, capped at
 * 10 MB, stored as `<uuid>.<ext>` under DATA_DIR/images, and described by an `images` row. File
 * removal tolerates an already-missing file, so every cleanup path can call it blindly.
 */
export class ImagesService {
  private readonly byId;
  private readonly byStoredNameStmt;
  private readonly forSlot;
  private readonly forUploader;
  private readonly insert;
  private readonly remove;

  constructor(
    db: DatabaseSync,
    private readonly imagesDir: string,
    private readonly log: Logger,
  ) {
    this.byId = db.prepare("SELECT * FROM images WHERE id = :id");
    this.byStoredNameStmt = db.prepare("SELECT * FROM images WHERE stored_name = :stored_name");
    this.forSlot = db.prepare(
      "SELECT * FROM images WHERE slot_id = :slot_id ORDER BY created_at, id",
    );
    this.forUploader = db.prepare("SELECT * FROM images WHERE uploader_id = :uploader_id");
    this.insert = db.prepare(
      `INSERT INTO images (slot_id, uploader_id, stored_name, original_name, mime, bytes, created_at)
       VALUES (:slot_id, :uploader_id, :stored_name, :original_name, :mime, :bytes, :created_at)`,
    );
    this.remove = db.prepare("DELETE FROM images WHERE id = :id");
  }

  get(id: number): Image | null {
    return (this.byId.get({ id }) as Image | undefined) ?? null;
  }

  byStoredName(storedName: string): Image | null {
    return (this.byStoredNameStmt.get({ stored_name: storedName }) as Image | undefined) ?? null;
  }

  listForSlot(slotId: number): Image[] {
    return this.forSlot.all({ slot_id: slotId }) as unknown as Image[];
  }

  listByUploader(uploaderId: number): Image[] {
    return this.forUploader.all({ uploader_id: uploaderId }) as unknown as Image[];
  }

  pathOf(storedName: string): string {
    return `${this.imagesDir}/${storedName}`;
  }

  /**
   * Streams one upload to disk. Rejects with 415 `image_type_not_allowed` when the magic bytes
   * don't match the allow-list (the extension and Content-Type are ignored) and 413
   * `image_too_large` past 10 MB; nothing beyond the cap is ever buffered or kept.
   */
  async store(input: StoreImageInput): Promise<Image> {
    // The sniffer speaks Web streams; the multipart part is a Node stream. Bridge both ways.
    const web = Readable.toWeb(input.stream) as ReadableStream<Uint8Array>;
    const detection = await fileTypeStream(web, { sampleSize: SNIFF_BYTES });
    const type = detection.fileType;
    const sniffed = Readable.fromWeb(detection as ReadableStream<Uint8Array>);
    if (!type || !ALLOWED.has(type.ext)) {
      // Drain so the multipart parser finishes the request, then refuse.
      sniffed.resume();
      await new Promise<void>((resolve) => sniffed.once("end", resolve).once("error", resolve));
      throw new HttpError(415, "image_type_not_allowed", "that file is not a supported image", {
        detected: type?.mime ?? null,
      });
    }
    const storedName = `${randomUUID()}.${type.ext}`;
    const finalPath = this.pathOf(storedName);
    const partPath = `${finalPath}.part`;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > IMAGE_MAX_BYTES) {
          cb(new HttpError(413, "image_too_large", "images are at most 10 MB"));
          return;
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(sniffed, counter, createWriteStream(partPath, { flags: "wx" }));
    } catch (err) {
      await unlink(partPath).catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (err instanceof HttpError) throw err;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        throw new HttpError(413, "image_too_large", "images are at most 10 MB");
      }
      throw err;
    }
    // The parser truncates at the cap instead of erroring (nothing past it is read into memory);
    // a truncated part is an oversized upload.
    if ((input.stream as { truncated?: boolean }).truncated) {
      await unlink(partPath).catch(() => undefined);
      throw new HttpError(413, "image_too_large", "images are at most 10 MB");
    }
    await rename(partPath, finalPath);
    const created_at = new Date().toISOString();
    const result = this.insert.run({
      slot_id: input.slotId,
      uploader_id: input.uploaderId,
      stored_name: storedName,
      original_name: input.originalName.slice(0, 255) || storedName,
      mime: type.mime,
      bytes,
      created_at,
    });
    return this.get(Number(result.lastInsertRowid)) as Image;
  }

  /** Deletes the row; the file goes separately so DB transactions never wait on the disk. */
  removeRow(id: number): void {
    this.remove.run({ id });
  }

  /** Removes the file if it is still there; a missing file is not an error (§3.8). */
  async unlinkFile(storedName: string): Promise<void> {
    try {
      await unlink(this.pathOf(storedName));
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") {
        this.log.warn({ err, storedName }, "images.unlink_failed");
      }
    }
  }

  async removeFiles(images: Pick<Image, "stored_name">[]): Promise<void> {
    await Promise.all(images.map((i) => this.unlinkFile(i.stored_name)));
  }
}
