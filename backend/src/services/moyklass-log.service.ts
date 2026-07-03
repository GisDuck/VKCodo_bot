import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type LogPayload = Record<string, unknown>;

export class MoyKlassLogService {
  private readonly logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
  private readonly logFile = path.join(this.logDir, "moyklass-requests.jsonl");

  async write(payload: LogPayload): Promise<void> {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...payload
    });

    try {
      await mkdir(this.logDir, { recursive: true });
      await appendFile(this.logFile, `${line}\n`, "utf8");
    } catch (error) {
      console.error("Failed to write MoyKlass request log", error);
    }
  }
}
