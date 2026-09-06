import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const archive = "doubleclick-dictionary.zip";

await rm(archive, { force: true });
await run("zip", ["-r", `../${archive}`, "."], { cwd: "dist" });

