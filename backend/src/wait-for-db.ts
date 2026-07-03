import net from "node:net";
import { env } from "./config/env.js";

const url = new URL(env.DATABASE_URL);
const host = url.hostname;
const port = Number(url.port || 5432);
const maxAttempts = 30;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const connected = await canConnect(host, port);
  if (connected) process.exit(0);
  console.log(`Waiting for database ${host}:${port}, attempt ${attempt}/${maxAttempts}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error(`Database ${host}:${port} is not reachable`);
process.exit(1);

function canConnect(targetHost: string, targetPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: targetHost, port: targetPort, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
