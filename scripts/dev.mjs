import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, extraEnv = {}) {
  return spawn(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
}

function waitForVite() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get("http://127.0.0.1:5173", (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > 40000) {
          reject(new Error("Vite-Server startete nicht."));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

const vite = run("npx vite --port 5173 --strictPort --host 127.0.0.1");
vite.on("exit", (code) => {
  if (code && code !== 0) process.exit(code);
});

try {
  await waitForVite();
} catch (err) {
  console.error(err.message);
  vite.kill();
  process.exit(1);
}

const electron = run("npx electron .", {
  ELECTRON_START_URL: "http://127.0.0.1:5173",
});
console.log("Electron gestartet.");

function shutdown() {
  electron.kill();
  vite.kill();
}

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
