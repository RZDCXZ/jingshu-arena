import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import sharp from "sharp";
import type { RepairImageContentType } from "@jingshu/contracts";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_ACTIVE_DECODES = 2;
const MAX_QUEUED_DECODES = 6;
let activeDecodes = 0;
const decodeWaiters: Array<() => void> = [];

export interface RepairUploadTokenPayload {
  readonly contentType: RepairImageContentType;
  readonly expiresAt: string;
  readonly intentId: string;
  readonly kind: "repair-upload";
  readonly objectKey: string;
  readonly repairId: string;
  readonly sandboxId: string;
  readonly size: number;
}

export interface RepairReadTokenPayload {
  readonly expiresAt: number;
  readonly imageId: string;
  readonly kind: "repair-read";
  readonly sandboxId: string;
}

type RepairImageTokenPayload =
  RepairReadTokenPayload | RepairUploadTokenPayload;

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signRepairImageToken(
  payload: RepairImageTokenPayload,
  secret: string,
) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function verifyRepairImageToken(
  token: string | undefined,
  secret: string,
): RepairImageTokenPayload | null {
  if (!token) return null;
  const [body, suppliedSignature, extra] = token.split(".");
  if (!body || !suppliedSignature || extra) return null;
  const expectedSignature = signature(body, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as RepairImageTokenPayload;
  } catch {
    return null;
  }
}

function magicMatches(bytes: Uint8Array, contentType: RepairImageContentType) {
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

const sharpFormats: Record<RepairImageContentType, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export class RepairImageSanitizationError extends Error {
  readonly code = "REPAIR_IMAGE_SANITIZATION_FAILED";

  constructor() {
    super("The repair image could not be safely decoded and sanitized.");
    this.name = "RepairImageSanitizationError";
  }
}

export class RepairImageProcessingBusyError extends Error {
  readonly code = "REPAIR_IMAGE_PROCESSING_BUSY";

  constructor() {
    super("Repair image processing is at capacity.");
    this.name = "RepairImageProcessingBusyError";
  }
}

async function acquireDecodeSlot() {
  if (activeDecodes < MAX_ACTIVE_DECODES) {
    activeDecodes += 1;
  } else {
    if (decodeWaiters.length >= MAX_QUEUED_DECODES) {
      throw new RepairImageProcessingBusyError();
    }
    await new Promise<void>((resolve) => {
      decodeWaiters.push(() => {
        activeDecodes += 1;
        resolve();
      });
    });
  }
  return () => {
    activeDecodes -= 1;
    decodeWaiters.shift()?.();
  };
}

export async function sanitizeRepairImage(input: {
  readonly bytes: Uint8Array;
  readonly contentType: RepairImageContentType;
}) {
  const release = await acquireDecodeSlot();
  try {
    return await sanitizeRepairImageWithSlot(input);
  } finally {
    release();
  }
}

async function sanitizeRepairImageWithSlot(input: {
  readonly bytes: Uint8Array;
  readonly contentType: RepairImageContentType;
}) {
  if (
    input.bytes.byteLength < 12 ||
    input.bytes.byteLength > MAX_BYTES ||
    !magicMatches(input.bytes, input.contentType)
  ) {
    throw new RepairImageSanitizationError();
  }
  try {
    const source = sharp(input.bytes, {
      failOn: "error",
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    });
    const metadata = await source.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      metadata.format !== sharpFormats[input.contentType] ||
      (metadata.pages ?? 1) !== 1 ||
      width < 1 ||
      height < 1 ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    ) {
      throw new RepairImageSanitizationError();
    }
    const oriented = source.rotate();
    const output =
      input.contentType === "image/jpeg"
        ? await oriented.jpeg({ mozjpeg: true, quality: 88 }).toBuffer()
        : input.contentType === "image/png"
          ? await oriented.png({ compressionLevel: 9 }).toBuffer()
          : await oriented.webp({ quality: 88 }).toBuffer();
    if (output.byteLength < 1 || output.byteLength > MAX_BYTES) {
      throw new RepairImageSanitizationError();
    }
    const sanitizedMetadata = await sharp(output).metadata();
    const sanitizedWidth = sanitizedMetadata.width ?? 0;
    const sanitizedHeight = sanitizedMetadata.height ?? 0;
    if (
      sanitizedMetadata.format !== sharpFormats[input.contentType] ||
      sanitizedWidth < 1 ||
      sanitizedHeight < 1 ||
      sanitizedWidth * sanitizedHeight > MAX_PIXELS
    ) {
      throw new RepairImageSanitizationError();
    }
    const extension =
      input.contentType === "image/jpeg"
        ? "jpg"
        : input.contentType === "image/png"
          ? "png"
          : "webp";
    return {
      bytes: output,
      contentType: input.contentType,
      height: sanitizedHeight,
      objectName: `${randomUUID()}.${extension}`,
      width: sanitizedWidth,
    };
  } catch (error) {
    if (error instanceof RepairImageSanitizationError) throw error;
    throw new RepairImageSanitizationError();
  }
}
