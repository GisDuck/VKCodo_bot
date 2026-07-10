import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pruneOldLogs } from "../lib/log-retention.js";
import { sanitizeLogPayload } from "../lib/log-sanitize.js";

type LogPayload = Record<string, unknown>;

export class MoyKlassLogService {
  private readonly logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
  private readonly logFile = path.join(this.logDir, "moyklass-requests.jsonl");

  async write(payload: LogPayload): Promise<void> {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...(sanitizeLogPayload(payload) as LogPayload)
    });

    try {
      await mkdir(this.logDir, { recursive: true });
      await pruneOldLogs(this.logDir);
      await appendFile(this.logFile, `${line}\n`, "utf8");
    } catch (error) {
      console.error("Failed to write MoyKlass request log", error);
    }
  }
}
