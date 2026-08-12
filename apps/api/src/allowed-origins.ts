interface AllowedOriginEnvironment {
  readonly developmentOrigins?: string;
  readonly nodeEnvironment?: string;
  readonly publicOrigin: string;
}

function assertExactHttpOrigin(origin: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`${origin} must be an exact HTTP origin.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== origin
  ) {
    throw new Error(`${origin} must be an exact HTTP origin.`);
  }
}

export function resolveAllowedOrigins({
  developmentOrigins,
  nodeEnvironment,
  publicOrigin,
}: AllowedOriginEnvironment): ReadonlyArray<string> {
  assertExactHttpOrigin(publicOrigin);
  if (nodeEnvironment === "production" || !developmentOrigins) {
    return [publicOrigin];
  }

  const origins = [
    publicOrigin,
    ...developmentOrigins.split(",").map((origin) => origin.trim()),
  ].filter((origin) => origin.length > 0);
  for (const origin of origins) assertExactHttpOrigin(origin);
  return [...new Set(origins)];
}
