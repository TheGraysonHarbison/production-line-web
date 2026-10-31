// Copies the built client (client/dist) into server/public so the server can serve it.
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = new URL("client/dist/", `file://${root}`);
const dest = new URL("server/public/", `file://${root}`);

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log("copied client/dist -> server/public");
