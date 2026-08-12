import { isIP } from "node:net";

/**
 * Node-only thin adapter: extract the TCP peer address before entering the
 * Fetch/Hono core. Public forwarding headers are intentionally not trusted.
 */
export function nodeClientIp(bindings: unknown): string | undefined {
  const incoming =
    typeof bindings === "object" && bindings !== null
      ? (
          bindings as {
            readonly incoming?: {
              readonly socket?: { readonly remoteAddress?: string | undefined };
            };
          }
        ).incoming
      : undefined;
  const candidate = incoming?.socket?.remoteAddress?.trim();
  if (!candidate || isIP(candidate) === 0) return undefined;
  if (candidate.startsWith("::ffff:")) {
    const mappedIpv4 = candidate.slice("::ffff:".length);
    if (isIP(mappedIpv4) === 4) return mappedIpv4;
  }
  return candidate.toLowerCase();
}
