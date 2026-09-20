import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(os.homedir(), "AppData", "Local", "desktop-notes-release");
const localRelease = path.join(root, "release");

fs.mkdirSync(outDir, { recursive: true });

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron-builder", "--win", `--config.directories.output=${outDir}`],
  { cwd: root, stdio: "inherit", shell: true },
);

const code = await new Promise((resolve) => child.on("close", resolve));
if (code !== 0) process.exit(code || 1);

fs.mkdirSync(localRelease, { recursive: true });
for (const name of fs.readdirSync(outDir)) {
  if (!name.endsWith(".exe")) continue;
  fs.copyFileSync(path.join(outDir, name), path.join(localRelease, name));
  console.log("Kopiert:", path.join(localRelease, name));
}
