import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_MAX_BYTES, SlotSchema } from "@production-line/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, request, seedRoles } from "./auth-helpers.js";
import { createTestApp, type TestApp } from "./helpers.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "e2e", "fixtures");
const PNG = readFileSync(join(fixtures, "checker.png"));
const RAF = readFileSync(join(fixtures, "sample.raf"));
const SCRIPT = readFileSync(join(fixtures, "script.png"));

const pad = (...parts: (number[] | string | Buffer)[]) =>
  Buffer.concat([
    ...parts.map((p) =>
      typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.isBuffer(p) ? p : Buffer.from(p),
    ),
    Buffer.alloc(512),
  ]);
/** Little-endian TIFF with one IFD at offset 8 holding `tagId` (DNG/ARW are told apart by tags). */
const tiffWithTag = (tagId: number) =>
  pad([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, tagId & 0xff, tagId >> 8]);

/** Minimal byte-signature samples for every type in the §3.8 allow-list. */
const SAMPLES: Record<string, { bytes: Buffer; mime: string }> = {
  png: { bytes: PNG, mime: "image/png" },
  jpg: { bytes: pad([0xff, 0xd8, 0xff, 0xe0]), mime: "image/jpeg" },
  tif: { bytes: pad([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0]), mime: "image/tiff" },
  webp: { bytes: pad("RIFF", [0, 0, 0, 0], "WEBPVP8 "), mime: "image/webp" },
  dng: { bytes: tiffWithTag(50_706), mime: "image/x-adobe-dng" },
  cr2: { bytes: pad([0x49, 0x49, 0x2a, 0x00, 0x10, 0, 0, 0], "CR"), mime: "image/x-canon-cr2" },
  cr3: { bytes: pad([0, 0, 0, 0x18], "ftypcrx "), mime: "image/x-canon-cr3" },
  nef: {
    bytes: pad([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0x1c, 0x00, 0xfe, 0x00]),
    mime: "image/x-nikon-nef",
  },
  arw: { bytes: tiffWithTag(50_341), mime: "image/x-sony-arw" },
  raf: { bytes: RAF, mime: "image/x-fujifilm-raf" },
  orf: { bytes: pad([0x49, 0x49, 0x52, 0x4f, 0x08, 0, 0, 0, 0x18]), mime: "image/x-olympus-orf" },
  rw2: {
    bytes: pad([0x49, 0x49, 0x55, 0x00, 0x18, 0, 0, 0, 0x88, 0xe7, 0x74, 0xd8]),
    mime: "image/x-panasonic-rw2",
  },
};

function multipart(file: { name: string; type: string; data: Buffer }) {
  const boundary = `----plw${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

type Roles = Awaited<ReturnType<typeof seedRoles>>;

function upload(
  t: TestApp,
  url: string,
  cookie: string | undefined,
  file: { name: string; type: string; data: Buffer },
  method: "POST" | "PUT" = "POST",
) {
  const { payload, contentType } = multipart(file);
  return t.app.inject({
    method,
    url,
    headers: { origin: ORIGIN, "content-type": contentType, ...(cookie ? { cookie } : {}) },
    payload,
  });
}

const at = (min: number) =>
  new Date(Math.ceil((Date.now() + min * 60_000) / 300_000) * 300_000).toISOString();

describe("images", () => {
  let t: TestApp;
  let roles: Roles;
  let printer: number;
  let slotId: number;
  const filesOnDisk = () =>
    readdirSync(t.ctx.dataDir.imagesDir).filter((f) => !f.endsWith(".part"));

  beforeEach(async () => {
    t = await createTestApp();
    roles = await seedRoles(t);
    t.ctx.settings.update({ images_enabled: true });
    const p = await request(t, "POST", "/api/printers", {
      cookie: roles.admin.cookie,
      body: { name: "Prusa" },
    });
    printer = p.json().id;
    const s = await request(t, "POST", "/api/slots", {
      cookie: roles.user.cookie,
      body: { name: "Benchy", start_at: at(30), end_at: at(90), printer_ids: [printer] },
    });
    expect(s.statusCode, s.body).toBe(201);
    slotId = s.json().id;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  describe("validation", () => {
    for (const [ext, sample] of Object.entries(SAMPLES)) {
      it(`accepts ${ext} by magic bytes, whatever the name and content-type say`, async () => {
        const res = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
          name: `photo.${ext === "jpg" ? "bin" : "dat"}`,
          type: "application/octet-stream",
          data: sample.bytes,
        });
        expect(res.statusCode, res.body).toBe(201);
        const slot = SlotSchema.parse(res.json());
        expect(slot.images).toHaveLength(1);
        const img = slot.images[0] as NonNullable<(typeof slot.images)[0]>;
        expect(img).toMatchObject({
          slot_id: slotId,
          uploader_id: roles.user.me.id,
          mime: sample.mime,
          bytes: sample.bytes.length,
          original_name: `photo.${ext === "jpg" ? "bin" : "dat"}`,
        });
        expect(img.stored_name).toMatch(new RegExp(`^[0-9a-f-]{36}\\.${ext}$`));
        expect(existsSync(join(t.ctx.dataDir.imagesDir, img.stored_name))).toBe(true);
      });
    }

    it("rejects a script renamed .png, and image/png with the wrong bytes", async () => {
      for (const file of [
        { name: "script.png", type: "application/octet-stream", data: SCRIPT },
        { name: "totally.png", type: "image/png", data: Buffer.from("GIF89a not really") },
      ]) {
        const res = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, file);
        expect(res.statusCode, res.body).toBe(415);
        expect(res.json().error).toBe("image_type_not_allowed");
      }
      expect(filesOnDisk()).toEqual([]);
      expect(t.ctx.slots.get(slotId).images).toEqual([]);
    });

    it("refuses 10 MB + 1 byte and keeps nothing on disk", async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES + 1 - PNG.length)]);
      const res = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "huge.png",
        type: "image/png",
        data: big,
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(413);
      expect(res.json().error).toBe("image_too_large");
      expect(filesOnDisk()).toEqual([]);
      // Exactly 10 MB is fine.
      const ok = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "max.png",
        type: "image/png",
        data: Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES - PNG.length)]),
      });
      expect(ok.statusCode, ok.body.slice(0, 200)).toBe(201);
    });

    it("needs a multipart body with a file", async () => {
      const res = await request(t, "POST", `/api/slots/${slotId}/images`, {
        cookie: roles.user.cookie,
        body: { nope: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("multipart_required");
    });
  });

  describe("gating and access", () => {
    it("403s uploads when images are disabled, but still serves and deletes existing ones", async () => {
      const first = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "a.png",
        type: "image/png",
        data: PNG,
      });
      const stored = first.json().images[0].stored_name as string;
      t.ctx.settings.update({ images_enabled: false });
      const blocked = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "b.png",
        type: "image/png",
        data: PNG,
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toBe("images_disabled");
      const served = await request(t, "GET", `/api/images/${stored}`, {
        cookie: roles.user.cookie,
      });
      expect(served.statusCode).toBe(200);
      const del = await request(
        t,
        "DELETE",
        `/api/slots/${slotId}/images/${first.json().images[0].id}`,
        {
          cookie: roles.user.cookie,
        },
      );
      expect(del.statusCode).toBe(204);
    });

    it("follows the slot access rule: other users 403, admins allowed", async () => {
      const other = await upload(t, `/api/slots/${slotId}/images`, roles.admin.cookie, {
        name: "admin.png",
        type: "image/png",
        data: PNG,
      });
      expect(other.statusCode, other.body).toBe(201);
      const second = await request(t, "POST", "/api/auth/register", {
        body: { username: "stranger", password: "userpass1", favorite_color: "#123456" },
      });
      const strangerCookie = second.headers["set-cookie"] as string;
      const denied = await upload(t, `/api/slots/${slotId}/images`, strangerCookie.split(";")[0], {
        name: "x.png",
        type: "image/png",
        data: PNG,
      });
      expect(denied.statusCode).toBe(403);
      expect(
        (
          await upload(t, `/api/slots/${slotId}/images`, undefined, {
            name: "x.png",
            type: "image/png",
            data: PNG,
          })
        ).statusCode,
      ).toBe(401);
    });

    it("deleting an image needs it to belong to that slot", async () => {
      const up = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "a.png",
        type: "image/png",
        data: PNG,
      });
      const imageId = up.json().images[0].id as number;
      const otherSlot = await request(t, "POST", "/api/slots", {
        cookie: roles.user.cookie,
        body: { name: "Other", start_at: at(120), end_at: at(150), printer_ids: [printer] },
      });
      const wrong = await request(
        t,
        "DELETE",
        `/api/slots/${otherSlot.json().id}/images/${imageId}`,
        {
          cookie: roles.user.cookie,
        },
      );
      expect(wrong.statusCode).toBe(404);
      const events: string[] = [];
      t.ctx.events.onAny((n) => events.push(n));
      const right = await request(t, "DELETE", `/api/slots/${slotId}/images/${imageId}`, {
        cookie: roles.user.cookie,
      });
      expect(right.statusCode).toBe(204);
      expect(events).toEqual(["slot.updated"]);
      expect(filesOnDisk()).toEqual([]);
      expect(t.ctx.slots.get(slotId).images).toEqual([]);
    });
  });

  describe("serving", () => {
    it("requires a session, sets nosniff, inline for PNG and attachment for RAW", async () => {
      const png = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "Bench y.png",
        type: "image/png",
        data: PNG,
      });
      const raf = await upload(t, `/api/slots/${slotId}/images`, roles.user.cookie, {
        name: "DSCF0001.RAF",
        type: "application/octet-stream",
        data: RAF,
      });
      const pngName = png.json().images[0].stored_name as string;
      const rafName = raf.json().images[1].stored_name as string;
      expect((await request(t, "GET", `/api/images/${pngName}`)).statusCode).toBe(401);

      const a = await request(t, "GET", `/api/images/${pngName}`, { cookie: roles.admin.cookie });
      expect(a.statusCode).toBe(200);
      expect(a.headers["x-content-type-options"]).toBe("nosniff");
      expect(a.headers["content-type"]).toBe("image/png");
      expect(a.headers["content-disposition"]).toMatch(/^inline; filename="Bench y.png"/);
      expect(a.rawPayload.equals(PNG)).toBe(true);

      const b = await request(t, "GET", `/api/images/${rafName}`, { cookie: roles.user.cookie });
      expect(b.statusCode).toBe(200);
      expect(b.headers["content-type"]).toBe("image/x-fujifilm-raf");
      expect(b.headers["content-disposition"]).toMatch(/^attachment; filename="DSCF0001.RAF"/);
      expect(b.headers["x-content-type-options"]).toBe("nosniff");

      expect(
        (
          await request(t, "GET", "/api/images/00000000-0000-0000-0000-000000000000.png", {
            cookie: roles.user.cookie,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await request(t, "GET", "/api/images/..%2Fapp.db", { cookie: roles.user.cookie }))
          .statusCode,
      ).toBe(400);
    });
  });

  describe("cleanup", () => {
    const addImage = async (id: number, cookie: string) => {
      const res = await upload(t, `/api/slots/${id}/images`, cookie, {
        name: "a.png",
        type: "image/png",
        data: PNG,
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().images.at(-1).stored_name as string;
    };
    const settle = () => new Promise((r) => setTimeout(r, 50));

    it("removes files on manual slot delete", async () => {
      await addImage(slotId, roles.user.cookie);
      await addImage(slotId, roles.user.cookie);
      expect(filesOnDisk()).toHaveLength(2);
      const del = await request(t, "DELETE", `/api/slots/${slotId}`, { cookie: roles.user.cookie });
      expect(del.statusCode).toBe(204);
      await settle();
      expect(filesOnDisk()).toEqual([]);
    });

    it("removes files on expiry", async () => {
      await addImage(slotId, roles.user.cookie);
      t.ctx.slots.delete(slotId, "expired");
      await settle();
      expect(filesOnDisk()).toEqual([]);
    });

    it("removes slot images, uploads on others' slots, and the avatar on user delete", async () => {
      await addImage(slotId, roles.user.cookie);
      // The admin uploads onto the user's slot (an image the user didn't upload) and owns an avatar.
      await addImage(slotId, roles.admin.cookie);
      const avatar = await upload(
        t,
        "/api/me/avatar",
        roles.admin.cookie,
        { name: "me.png", type: "image/png", data: PNG },
        "PUT",
      );
      expect(avatar.statusCode, avatar.body).toBe(200);
      expect(avatar.json().avatar_url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.png$/);
      expect(filesOnDisk()).toHaveLength(3);
      // Deleting the admin removes their avatar and their upload on the user's slot; the user's own image stays.
      const del = await request(t, "DELETE", `/api/users/${roles.admin.me.id}`, {
        cookie: roles.owner.cookie,
      });
      expect(del.statusCode).toBe(204);
      await settle();
      expect(filesOnDisk()).toHaveLength(1);
      expect(t.ctx.slots.get(slotId).images).toHaveLength(1);
      // Deleting the user removes their slot and its remaining image.
      const del2 = await request(t, "DELETE", `/api/users/${roles.user.me.id}`, {
        cookie: roles.owner.cookie,
      });
      expect(del2.statusCode).toBe(204);
      await settle();
      expect(filesOnDisk()).toEqual([]);
    });

    it("avatar replace deletes the old file; remove clears it; everyone sees avatar_url", async () => {
      const first = await upload(
        t,
        "/api/me/avatar",
        roles.user.cookie,
        { name: "one.png", type: "image/png", data: PNG },
        "PUT",
      );
      expect(first.statusCode, first.body).toBe(200);
      const url1 = first.json().avatar_url as string;
      const second = await upload(
        t,
        "/api/me/avatar",
        roles.user.cookie,
        { name: "two.png", type: "image/png", data: PNG },
        "PUT",
      );
      const url2 = second.json().avatar_url as string;
      expect(url2).not.toBe(url1);
      await settle();
      expect(filesOnDisk()).toEqual([url2.split("/").at(-1)]);
      // Visible on /api/me, /api/users, and embedded in slots.
      expect(
        (await request(t, "GET", "/api/me", { cookie: roles.user.cookie })).json().avatar_url,
      ).toBe(url2);
      const users = (
        await request(t, "GET", "/api/users", { cookie: roles.user.cookie })
      ).json() as { id: number; avatar_url: string | null }[];
      expect(users.find((u) => u.id === roles.user.me.id)?.avatar_url).toBe(url2);
      expect(t.ctx.slots.get(slotId).user.avatar_url).toBe(url2);
      const events: string[] = [];
      t.ctx.events.onAny((n) => events.push(n));
      const removed = await request(t, "DELETE", "/api/me/avatar", { cookie: roles.user.cookie });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().avatar_url).toBeNull();
      expect(events).toEqual(["user.updated"]);
      await settle();
      expect(filesOnDisk()).toEqual([]);
    });
  });
});
