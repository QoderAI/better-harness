import { mkdir } from "node:fs/promises";
import path from "node:path";

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateParts(now = new Date()) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
}

export function targetSlug(targetPath, fallback = "target") {
  const base = path.basename(path.resolve(targetPath || fallback)) || fallback;
  const slug = base
    .replace(/[:\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "target";
}

export async function allocateRunDir({ outDir, targetPath, now = new Date() }) {
  const { date, time } = dateParts(now);
  const dateDir = path.resolve(outDir, date);
  await mkdir(dateDir, { recursive: true });

  const baseName = `${time}-${targetSlug(targetPath)}`;
  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? baseName : `${baseName}-${index + 1}`;
    const runDir = path.join(dateDir, name);
    try {
      await mkdir(runDir, { recursive: false });
      return runDir;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not allocate collision-safe run directory under ${dateDir}`);
}
