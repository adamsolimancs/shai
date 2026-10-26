import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";

// Trust only a header overwritten by the configured ingress, never an ordinary
// browser's x-forwarded-for or x-shai-visitor-id.
export async function backendHeaders(extra?: HeadersInit): Promise<Headers> {
  const result = new Headers(extra);
  const key = process.env.BACKEND_API_KEY;
  if (!key) throw new Error("BACKEND_API_KEY must be set to call the backend.");
  result.set("x-api-key", key);
  result.delete("x-shai-visitor-id");

  const trustedHeader = process.env.VERCEL === "1"
    ? "x-vercel-forwarded-for"
    : process.env.TRUSTED_CLIENT_IP_HEADER;
  if (!trustedHeader) return result;

  // No request context during build/background calls: use backend peer budgets.
  let incoming;
  try {
    incoming = await headers();
  } catch {
    return result;
  }
  const ip = incoming.get(trustedHeader)?.trim();
  if (ip && !ip.includes("%") && isIP(ip)) {
    const normalized = isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;
    result.set("x-shai-visitor-id", createHmac("sha256", key).update(`visitor:v1:${normalized}`).digest("hex"));
  }
  return result;
}
