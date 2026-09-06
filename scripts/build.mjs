import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await run(process.execPath, ["node_modules/typescript/bin/tsc"]);
await cp("extension", "dist", { recursive: true });
await cp("LICENSE", "dist/LICENSE");

const configuration = JSON.parse(await readFile("dictionary.config.json", "utf8"));
if (typeof configuration.baseUrl !== "string") throw new Error("dictionary.config.json needs a baseUrl");
const dictionaryUrl = new URL(configuration.baseUrl);
if (!["http:", "https:"].includes(dictionaryUrl.protocol)) throw new Error("dictionary baseUrl must use HTTP or HTTPS");
if (dictionaryUrl.protocol === "http:" && !["localhost", "127.0.0.1"].includes(dictionaryUrl.hostname)) {
  throw new Error("dictionary baseUrl must use HTTPS unless it is local");
}
if (dictionaryUrl.username || dictionaryUrl.password || dictionaryUrl.search || dictionaryUrl.hash) {
  throw new Error("dictionary baseUrl cannot contain credentials, a query, or a fragment");
}

const baseUrl = dictionaryUrl.toString().replace(/\/$/, "");
await writeFile("dist/dictionary-config.json", `${JSON.stringify({ baseUrl }, null, 2)}\n`);

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
manifest.host_permissions = [`${dictionaryUrl.protocol}//${dictionaryUrl.hostname}/*`];
await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
