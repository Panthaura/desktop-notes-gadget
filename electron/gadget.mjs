import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const csPath = path.join(here, "native", "GadgetPin.cs");
const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function pinExeCandidates() {
  const local = path.join(here, "native", "GadgetPin.exe");
  return [
    local,
    local.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`),
    path.join(process.resourcesPath || "", "GadgetPin.exe"),
  ];
}

function resolvePinExe() {
  return pinExeCandidates().find((file) => existsSync(file)) || pinExeCandidates()[0];
}

function hwndFromBuffer(handle) {
  if (handle.length >= 8) {
    return handle.readBigUInt64LE(0).toString();
  }
  return String(handle.readUInt32LE(0));
}

export async function compilePinHelper() {
  const existing = resolvePinExe();
  const stale =
    existsSync(existing) &&
    existsSync(csPath) &&
    statSync(csPath).mtimeMs > statSync(existing).mtimeMs;
  if (existsSync(existing) && !stale) return existing;
  const exePath = path.join(here, "native", "GadgetPin.exe");
  if (!existsSync(csc)) {
    if (existsSync(existing)) return existing;
    throw new Error("csc.exe nicht gefunden, Gadget-Pin kann nicht gebaut werden.");
  }
  await execFileAsync(csc, ["/nologo", "/target:exe", `/out:${exePath}`, csPath]);
  return exePath;
}

export async function pinAsDesktopGadget(browserWindow, mode = "tool") {
  const hwnd = hwndFromBuffer(browserWindow.getNativeWindowHandle());
  const exe = await compilePinHelper();
  await execFileAsync(exe, [hwnd, mode]);
}
