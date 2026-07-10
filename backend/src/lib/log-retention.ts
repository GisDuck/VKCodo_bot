import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

export async function pruneOldLogs(logDir: string): Promise<void> {
  const cutoff = Date.now() - env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  try {
    const entries = await readdir(logDir);
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".jsonl"))
        .map(async (entry) => {
          const file = path.join(logDir, entry);
          const info = await stat(file);
          if (info.mtimeMs < cutoff) await unlink(file);
        })
    );
  } catch {
    // Log pruning must never block request processing.
  }
}
