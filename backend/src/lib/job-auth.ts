import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";

const JOB_TOKEN_HEADER = "x-job-token";

export function isAuthorizedJobRequest(request: FastifyRequest): boolean {
  const header = request.headers[JOB_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  return verifyJobToken(token);
}

export function verifyJobToken(token: string | undefined): boolean {
  return Boolean(env.JOB_SECRET) && token === env.JOB_SECRET;
}
