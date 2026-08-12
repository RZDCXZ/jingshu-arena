interface BrowserUuidCrypto {
  getRandomValues(target: Uint8Array): Uint8Array;
  randomUUID?: () => string;
}

function byteToHex(value: number | undefined) {
  return (value ?? 0).toString(16).padStart(2, "0");
}

export function createBrowserUuid(
  cryptoSource: BrowserUuidCrypto = globalThis.crypto,
): string {
  if (typeof cryptoSource.randomUUID === "function") {
    return cryptoSource.randomUUID.call(cryptoSource);
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, byteToHex);

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
