import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  AssignRepairRequest,
  ClaimRepairSpareRequest,
  CreateCustomerRepairRequest,
  CreateRepairImageIntentRequest,
  CreateStaffRepairRequest,
  RepairCommandResponse,
  RepairCreatedResponse,
  RepairDetailResponse,
  RepairImageCompletionResponse,
  RepairImageContentType,
  RepairImageIntentResponse,
  RepairImageListResponse,
  RepairSampleImageResponse,
  RepairResolutionCommandResponse,
  RepairSpareCommandResponse,
  RepairVerificationCommandResponse,
  ReturnRepairSpareRequest,
  StartRepairRequest,
  StaffRepairIntakeResponse,
  StaffRepairQueueResponse,
  SubmitRepairResolutionRequest,
  VerifyRepairRequest,
} from "@jingshu/contracts";
import type {
  RepairCommandConflictError,
  RepairCommandConflictReason,
  RepairImageConflictError,
  RepairImageConflictReason,
  RepairIntakeConflictError,
  RepairIntakeConflictReason,
} from "@jingshu/database";
import { normalizeRepairDescription } from "@jingshu/domain";

import {
  RepairImageSanitizationError,
  sanitizeRepairImage,
  signRepairImageToken,
  verifyRepairImageToken,
} from "./repair-image-processing.js";
import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  UUID_V4_PATTERN,
  csrfTokensMatch,
  errorBody,
  isPlainRecord,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  type AppServices,
} from "./route-support.js";

function isRepairConflict(error: unknown): error is RepairIntakeConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "REPAIR_INTAKE_CONFLICT" &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function isRepairCommandConflict(
  error: unknown,
): error is RepairCommandConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "REPAIR_COMMAND_CONFLICT" &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function isRepairImageConflict(
  error: unknown,
): error is RepairImageConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "REPAIR_IMAGE_CONFLICT" &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function repairFailure(error: unknown, requestId: string) {
  if (isRoleContextStale(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_STALE",
        "当前标签的旧角色上下文已失效，请刷新到当前角色。",
        requestId,
      ),
      status: 409 as const,
    };
  }
  if (isRoleContextUnavailable(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
        "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  if (isRepairConflict(error)) {
    const failures: Record<
      RepairIntakeConflictReason,
      { code: string; message: string; status: 404 | 409 | 422 }
    > = {
      "description-invalid": {
        code: "REPAIR_DESCRIPTION_INVALID",
        message: "故障描述需为 1–500 字规范纯文本，请勿填写真实个人信息。",
        status: 422,
      },
      "idempotency-conflict": {
        code: "REPAIR_IDEMPOTENCY_CONFLICT",
        message: "本次提交标识已用于其他报修内容，请检查后重新提交。",
        status: 409,
      },
      "reservation-ineligible": {
        code: "REPAIR_RESERVATION_INELIGIBLE",
        message: "顾客只能为自己当前使用中预约的明确座位提交报修。",
        status: 409,
      },
      "reservation-not-found": {
        code: "REPAIR_RESERVATION_NOT_FOUND",
        message: "未找到当前顾客可报修的预约。",
        status: 404,
      },
      "seat-not-found": {
        code: "REPAIR_SEAT_NOT_FOUND",
        message: "未找到当前门店可报修的座位。",
        status: 404,
      },
    };
    const failure = failures[error.reason];
    return {
      body: errorBody(failure.code, failure.message, requestId),
      status: failure.status,
    };
  }
  if (isRepairCommandConflict(error)) {
    const failures: Record<
      RepairCommandConflictReason,
      { code: string; message: string; status: 403 | 404 | 409 | 422 }
    > = {
      "assignee-not-found": {
        code: "REPAIR_ASSIGNEE_NOT_FOUND",
        message: "请选择本店可用的店员或店长作为处理人。",
        status: 422,
      },
      "cross-store": {
        code: "REPAIR_NOT_FOUND",
        message: "未找到当前角色可访问的报修。",
        status: 404,
      },
      "idempotency-conflict": {
        code: "REPAIR_COMMAND_IDEMPOTENCY_CONFLICT",
        message: "本次操作标识已用于其他报修内容，请刷新后重试。",
        status: 409,
      },
      "illegal-transition": {
        code: "REPAIR_ILLEGAL_TRANSITION",
        message: "报修状态已经变化，请刷新详情后继续。",
        status: 409,
      },
      "inventory-insufficient": {
        code: "REPAIR_SPARE_INSUFFICIENT",
        message: "备件可用库存不足，报修与库存均未变更。",
        status: 409,
      },
      "inventory-item-not-found": {
        code: "REPAIR_SPARE_NOT_FOUND",
        message: "未找到当前报修可领用的本店备件。",
        status: 404,
      },
      "note-invalid": {
        code: "REPAIR_NOTE_INVALID",
        message: "说明需为允许长度内的规范纯文本。",
        status: 422,
      },
      "not-assignee": {
        code: "REPAIR_ASSIGNEE_REQUIRED",
        message: "只有当前处理人或店长可以开始处理。",
        status: 403,
      },
      "not-found": {
        code: "REPAIR_NOT_FOUND",
        message: "未找到当前角色可访问的报修。",
        status: 404,
      },
      "quantity-invalid": {
        code: "REPAIR_SPARE_QUANTITY_INVALID",
        message: "备件数量必须为正整数。",
        status: 422,
      },
      "return-exceeds-claim": {
        code: "REPAIR_SPARE_RETURN_EXCEEDS_CLAIM",
        message: "累计退回数量不能超过该次领用数量。",
        status: 409,
      },
      "usage-not-found": {
        code: "REPAIR_SPARE_USAGE_NOT_FOUND",
        message: "未找到当前报修可退回的备件领用记录。",
        status: 404,
      },
      "verifier-not-independent": {
        code: "REPAIR_INDEPENDENT_VERIFIER_REQUIRED",
        message: "处理人不能验证自己的维修，请由另一位同店员工或店长验证。",
        status: 403,
      },
    };
    const failure = failures[error.reason];
    return {
      body: errorBody(failure.code, failure.message, requestId),
      status: failure.status,
    };
  }
  if (
    isRepairImageConflict(error) ||
    error instanceof RepairImageSanitizationError
  ) {
    const reason = isRepairImageConflict(error)
      ? error.reason
      : ("image-invalid" as const);
    const failures: Record<
      RepairImageConflictReason,
      { code: string; message: string; status: 404 | 409 | 413 | 422 }
    > = {
      "content-type-mismatch": {
        code: "REPAIR_IMAGE_CONTENT_TYPE_MISMATCH",
        message: "图片格式与上传声明不一致，已安全丢弃；文字报修仍然有效。",
        status: 422,
      },
      "image-invalid": {
        code: "REPAIR_IMAGE_INVALID",
        message: "图片无法安全解析或清洗，已安全丢弃；文字报修仍然有效。",
        status: 422,
      },
      "image-too-large": {
        code: "REPAIR_IMAGE_TOO_LARGE",
        message: "单张图片不得超过 5MB，已安全丢弃；文字报修仍然有效。",
        status: 413,
      },
      "intent-expired": {
        code: "REPAIR_IMAGE_INTENT_EXPIRED",
        message: "本次图片上传已过期，请重新选择图片。",
        status: 409,
      },
      "intent-invalid": {
        code: "REPAIR_IMAGE_INTENT_INVALID",
        message: "图片上传凭证无效，请重新选择图片。",
        status: 404,
      },
      "intent-replay": {
        code: "REPAIR_IMAGE_INTENT_REPLAY",
        message: "该图片上传已经完成或失败，不能重复使用。",
        status: 409,
      },
      "max-images": {
        code: "REPAIR_IMAGE_LIMIT_REACHED",
        message: "每条报修最多保存 3 张图片。",
        status: 409,
      },
      "not-found": {
        code: "REPAIR_IMAGE_NOT_FOUND",
        message: "未找到当前角色可访问的报修图片。",
        status: 404,
      },
      "upload-not-staged": {
        code: "REPAIR_IMAGE_UPLOAD_INCOMPLETE",
        message: "图片尚未上传完成，请重新选择图片。",
        status: 409,
      },
    };
    const failure = failures[reason];
    return {
      body: errorBody(failure.code, failure.message, requestId),
      status: failure.status,
    };
  }
  return {
    body: errorBody(
      "REPAIR_SERVICE_UNAVAILABLE",
      "报修暂时无法保存；文字输入仍保留，请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

function repairSession(context: Context, services: AppServices) {
  return services.sessionSecret
    ? readRoleSession(
        getCookie(context, SESSION_COOKIE),
        services.sessionSecret,
      )
    : null;
}

async function repairWriteFence(
  context: Context,
  services: AppServices,
  requestId: string,
  session: NonNullable<ReturnType<typeof repairSession>>,
) {
  if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "invalid_origin",
    );
    return context.json(
      errorBody(
        "INVALID_REQUEST_ORIGIN",
        "请求来源无法验证，图片与报修文字均未变更。",
        requestId,
      ),
      403,
    );
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "csrf_context_mismatch",
    );
    return context.json(
      errorBody(
        "ROLE_CONTEXT_STALE",
        "当前标签的写入上下文已失效，请刷新后重试。",
        requestId,
      ),
      409,
    );
  }
  return null;
}

const repairImageContentTypes = new Set<RepairImageContentType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const REPAIR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const REPAIR_IMAGE_ORPHAN_GRACE_MS = 10 * 60 * 1_000;

async function cleanStoredRepairImageObject(
  storage: NonNullable<AppServices["repairImageStorage"]>,
  key: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await storage.delete(key);
      return true;
    } catch {
      // Private object cleanup is idempotent; retry without changing DB state.
    }
  }
  return false;
}

async function cleanOrQueueRepairImageObject(
  services: AppServices,
  input: {
    readonly key: string;
    readonly reason: string;
    readonly sandboxId: string;
  },
) {
  if (
    !services.repairImageStorage ||
    (await cleanStoredRepairImageObject(services.repairImageStorage, input.key))
  ) {
    return;
  }
  await services.sandboxDatabase
    ?.enqueueRepairImageCleanup({
      availableAt: new Date(),
      objectKey: input.key,
      reason: input.reason,
      sandboxId: input.sandboxId,
      targetKind: "object",
    })
    .catch(() => undefined);
}

async function readRepairImageBody(request: Request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > REPAIR_IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw Object.assign(new Error("Repair image exceeds the upload limit."), {
        code: "REPAIR_IMAGE_CONFLICT" as const,
        reason: "image-too-large" as const,
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function filenameExtension(filename: string) {
  const match = /\.([a-z0-9]+)$/iu.exec(filename.trim());
  const extension = match?.[1]?.toLowerCase();
  return extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    extension === "webp"
    ? extension
    : null;
}

function repairContext(
  session: NonNullable<ReturnType<typeof repairSession>>,
  repairId: string,
) {
  return {
    contextVersion: session.contextVersion,
    personaId: session.personaId,
    repairId,
    role: session.role,
    sandboxId: session.sandboxId,
  };
}

function readUrl(
  services: AppServices,
  image: { imageId: string; sandboxId: string },
) {
  const token = signRepairImageToken(
    {
      expiresAt: services.wallClock.now().getTime() + 5 * 60 * 1_000,
      imageId: image.imageId,
      kind: "repair-read",
      sandboxId: image.sandboxId,
    },
    services.repairImageSigningSecret!,
  );
  return `/api/v1/repair-images/${image.imageId}?token=${encodeURIComponent(token)}`;
}

async function customerSession(
  context: Context,
  services: AppServices,
  requestId: string,
) {
  const session = services.sessionSecret
    ? readRoleSession(
        getCookie(context, SESSION_COOKIE),
        services.sessionSecret,
      )
    : null;
  if (!session) {
    return {
      response: context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      ),
      session: null,
    };
  }
  if (session.role !== "customer") {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后为自己的当前座位提交报修。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function writeFence(
  context: Context,
  services: AppServices,
  requestId: string,
  session: NonNullable<Awaited<ReturnType<typeof customerSession>>["session"]>,
) {
  if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "invalid_origin",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，报修与座位状态均未变更。",
          requestId,
        ),
        403,
      ),
    };
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "csrf_context_mismatch",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "ROLE_CONTEXT_STALE",
          "当前标签的写入上下文已失效，请刷新后重试。",
          requestId,
        ),
        409,
      ),
    };
  }
  const idempotencyKey = context.req.header("Idempotency-Key");
  if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "报修提交标识已失效，请重新提交。",
          requestId,
        ),
        400,
      ),
    };
  }
  return { idempotencyKey, response: null };
}

async function staffSession(
  context: Context,
  services: AppServices,
  requestId: string,
) {
  const session = services.sessionSecret
    ? readRoleSession(
        getCookie(context, SESSION_COOKIE),
        services.sessionSecret,
      )
    : null;
  if (!session) {
    return {
      response: context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      ),
      session: null,
    };
  }
  if (session.role !== "staff" && session.role !== "manager") {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          "FRONTLINE_ROLE_REQUIRED",
          "请切换到店员或店长角色后处理本店报修。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function staffWriteFence(
  context: Context,
  services: AppServices,
  requestId: string,
  session: NonNullable<Awaited<ReturnType<typeof staffSession>>["session"]>,
) {
  if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "invalid_origin",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，报修与座位状态均未变更。",
          requestId,
        ),
        403,
      ),
    };
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "csrf_context_mismatch",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "ROLE_CONTEXT_STALE",
          "当前标签的写入上下文已失效，请刷新后重试。",
          requestId,
        ),
        409,
      ),
    };
  }
  const idempotencyKey = context.req.header("Idempotency-Key");
  if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "报修提交标识已失效，请重新提交。",
          requestId,
        ),
        400,
      ),
    };
  }
  return { idempotencyKey, response: null };
}

export function registerRepairIntakeRoutes(app: Hono, services: AppServices) {
  app.get("/api/v1/repairs/:repairId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    const repairId = context.req.param("repairId");
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (!UUID_V4_PATTERN.test(repairId)) {
      const failure = repairFailure(
        { code: "REPAIR_COMMAND_CONFLICT", reason: "not-found" },
        requestId,
      );
      return context.json(failure.body, failure.status);
    }
    try {
      const result = await services.sandboxDatabase.readRepairDetail({
        ...repairContext(session, repairId),
      });
      return context.json({
        ...result,
        currentTime: result.currentTime.toISOString(),
        impacts: result.impacts.map((impact) => ({
          ...impact,
          window: {
            endsAt: impact.window.endsAt.toISOString(),
            startsAt: impact.window.startsAt.toISOString(),
          },
        })),
        internal: result.internal
          ? {
              audits: result.internal.audits.map((audit) => ({
                ...audit,
                occurredAt: audit.occurredAt.toISOString(),
                recordedAt: audit.recordedAt.toISOString(),
              })),
              events: result.internal.events.map((event) => ({
                ...event,
                occurredAt: event.occurredAt.toISOString(),
                recordedAt: event.recordedAt.toISOString(),
              })),
              notes: result.internal.notes,
            }
          : null,
        publicUpdates: result.publicUpdates.map((update) => ({
          ...update,
          occurredAt: update.occurredAt.toISOString(),
        })),
        resolution: result.resolution
          ? {
              ...result.resolution,
              submittedAt: result.resolution.submittedAt.toISOString(),
            }
          : null,
        spares: result.spares
          ? {
              available: result.spares.available,
              usages: result.spares.usages.map((usage) => ({
                ...usage,
                claimedAt: usage.claimedAt.toISOString(),
                recordedAt: usage.recordedAt.toISOString(),
                returns: usage.returns.map((item) => ({
                  ...item,
                  recordedAt: item.recordedAt.toISOString(),
                  returnedAt: item.returnedAt.toISOString(),
                })),
              })),
            }
          : null,
        latestVerification: result.latestVerification
          ? {
              ...result.latestVerification,
              verifiedAt: result.latestVerification.verifiedAt.toISOString(),
            }
          : null,
      } satisfies RepairDetailResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/repairs/:repairId/images/proxy", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (
      !services.sandboxDatabase ||
      !services.sessionSecret ||
      !services.repairImageSigningSecret ||
      !services.repairImageStorage
    ) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    const fence = await repairWriteFence(context, services, requestId, session);
    if (fence) return fence;
    const repairId = context.req.param("repairId");
    const contentType = context.req.header("Content-Type")?.toLowerCase();
    const extension = filenameExtension(context.req.query("filename") ?? "");
    const contentLength = Number(context.req.header("Content-Length"));
    if (
      !UUID_V4_PATTERN.test(repairId) ||
      !repairImageContentTypes.has(contentType as RepairImageContentType) ||
      !extension ||
      (Number.isFinite(contentLength) && contentLength > REPAIR_IMAGE_MAX_BYTES)
    ) {
      const invalid = repairFailure(
        {
          code: "REPAIR_IMAGE_CONFLICT",
          reason:
            contentLength > REPAIR_IMAGE_MAX_BYTES
              ? "image-too-large"
              : "image-invalid",
        },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readRepairImageBody(context.req.raw);
    } catch (error) {
      const invalid = repairFailure(error, requestId);
      return context.json(invalid.body, invalid.status);
    }
    if (bytes.byteLength < 1) {
      const invalid = repairFailure(
        {
          code: "REPAIR_IMAGE_CONFLICT",
          reason: "image-invalid",
        },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    let intentId: string | null = null;
    let quarantineObjectKey: string | null = null;
    let finalized = false;
    let uploadClaimed = false;
    try {
      const actorContext = repairContext(session, repairId);
      const intent = await services.sandboxDatabase.createRepairImageIntent({
        ...actorContext,
        declaredContentType: contentType as RepairImageContentType,
        declaredSize: bytes.byteLength,
        filenameExtension: extension,
      });
      intentId = intent.intentId;
      quarantineObjectKey = intent.quarantineObjectKey;
      await services.sandboxDatabase.claimRepairImageUpload({
        declaredContentType: intent.declaredContentType,
        intentId,
        quarantineObjectKey,
        repairId,
        sandboxId: session.sandboxId,
        size: bytes.byteLength,
      });
      uploadClaimed = true;
      await services.repairImageStorage.put(quarantineObjectKey, bytes);
      await services.sandboxDatabase.completeRepairImageUpload({
        intentId,
        sandboxId: session.sandboxId,
      });
      await services.sandboxDatabase.prepareRepairImageCompletion({
        ...actorContext,
        intentId,
      });
      const sanitized = await sanitizeRepairImage({
        bytes,
        contentType: intent.declaredContentType,
      });
      const finalObjectKey = `finished/${session.sandboxId}/${sanitized.objectName}`;
      await services.sandboxDatabase.enqueueRepairImageCleanup({
        availableAt: new Date(
          services.wallClock.now().getTime() + REPAIR_IMAGE_ORPHAN_GRACE_MS,
        ),
        objectKey: finalObjectKey,
        reason: "unadopted-finished-object",
        sandboxId: session.sandboxId,
        targetKind: "object",
      });
      await services.repairImageStorage.put(finalObjectKey, sanitized.bytes);
      const image = await services.sandboxDatabase.finalizeRepairImage({
        ...actorContext,
        byteSize: sanitized.bytes.byteLength,
        contentType: sanitized.contentType,
        height: sanitized.height,
        intentId,
        objectKey: finalObjectKey,
        requestId,
        width: sanitized.width,
      });
      finalized = true;
      await cleanOrQueueRepairImageObject(services, {
        key: quarantineObjectKey,
        reason: "consumed-quarantine-object",
        sandboxId: session.sandboxId,
      });
      return context.json(
        {
          image: {
            byteSize: image.byteSize,
            contentType: image.contentType,
            createdAt: image.createdAt.toISOString(),
            height: image.height,
            imageId: image.imageId,
            readUrl: readUrl(services, image),
            source: "uploaded",
            status: "saved",
            width: image.width,
          },
          intentStatus: "consumed",
        } satisfies RepairImageCompletionResponse,
        201,
      );
    } catch (error) {
      if (quarantineObjectKey && !finalized) {
        await cleanOrQueueRepairImageObject(services, {
          key: quarantineObjectKey,
          reason: "failed-proxy-quarantine-object",
          sandboxId: session.sandboxId,
        });
      }
      if (intentId && uploadClaimed && !finalized) {
        await services.sandboxDatabase
          .failRepairImageIntent({
            intentId,
            reason: "proxy-failed",
            sandboxId: session.sandboxId,
          })
          .catch(() => undefined);
      }
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/repairs/:repairId/images/sample", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    const fence = await repairWriteFence(context, services, requestId, session);
    if (fence) return fence;
    const repairId = context.req.param("repairId");
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    if (
      !UUID_V4_PATTERN.test(repairId) ||
      !body ||
      Object.keys(body).some((key) => key !== "sampleAssetId") ||
      body.sampleAssetId !== "repair-headset-v1"
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "image-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    try {
      const image = await services.sandboxDatabase.createRepairSampleImage({
        ...repairContext(session, repairId),
        requestId,
        sampleAssetId: "repair-headset-v1",
      });
      return context.json(
        {
          image: {
            byteSize: image.byteSize,
            contentType: image.contentType,
            createdAt: image.createdAt.toISOString(),
            height: image.height,
            imageId: image.imageId,
            sampleAssetId: image.sampleAssetId,
            source: "sample",
            status: "saved",
            width: image.width,
          },
        } satisfies RepairSampleImageResponse,
        201,
      );
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/repairs/:repairId/images/intents", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (
      !services.sandboxDatabase ||
      !services.sessionSecret ||
      !services.repairImageSigningSecret ||
      !services.repairImageStorage
    ) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    const fence = await repairWriteFence(context, services, requestId, session);
    if (fence) return fence;
    const repairId = context.req.param("repairId");
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const contentType = body?.declaredContentType;
    const filename = body?.filename;
    const size = body?.size;
    const extension =
      typeof filename === "string" ? filenameExtension(filename) : null;
    if (
      !UUID_V4_PATTERN.test(repairId) ||
      !body ||
      Object.keys(body).some(
        (key) => !["declaredContentType", "filename", "size"].includes(key),
      ) ||
      typeof filename !== "string" ||
      filename.length < 1 ||
      filename.length > 180 ||
      !repairImageContentTypes.has(contentType as RepairImageContentType) ||
      !Number.isInteger(size) ||
      Number(size) < 1 ||
      !extension
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "image-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    try {
      const request = body as unknown as CreateRepairImageIntentRequest;
      const intent = await services.sandboxDatabase.createRepairImageIntent({
        ...repairContext(session, repairId),
        declaredContentType: request.declaredContentType,
        declaredSize: request.size,
        filenameExtension: extension,
      });
      const token = signRepairImageToken(
        {
          contentType: intent.declaredContentType,
          expiresAt: intent.expiresAt.toISOString(),
          intentId: intent.intentId,
          kind: "repair-upload",
          objectKey: intent.quarantineObjectKey,
          repairId: intent.repairId,
          sandboxId: intent.sandboxId,
          size: intent.declaredSize,
        },
        services.repairImageSigningSecret,
      );
      return context.json(
        {
          completeUrl: `/api/v1/repairs/${repairId}/images/intents/${intent.intentId}/complete`,
          expiresAt: intent.expiresAt.toISOString(),
          intentId: intent.intentId,
          uploadMethod: "PUT",
          uploadUrl: `/api/v1/repair-uploads/${intent.intentId}?token=${encodeURIComponent(token)}`,
        } satisfies RepairImageIntentResponse,
        201,
      );
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.put("/api/v1/repair-uploads/:intentId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (
      !services.sandboxDatabase ||
      !services.repairImageSigningSecret ||
      !services.repairImageStorage
    ) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const token = verifyRepairImageToken(
      context.req.query("token"),
      services.repairImageSigningSecret,
    );
    if (
      token?.kind !== "repair-upload" ||
      token.intentId !== context.req.param("intentId") ||
      Date.parse(token.expiresAt) <= services.wallClock.now().getTime() ||
      context.req.header("Content-Type")?.toLowerCase() !== token.contentType
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "intent-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    const declaredLength = Number(context.req.header("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > 0 &&
      declaredLength !== token.size
    ) {
      const mismatch = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "content-type-mismatch" },
        requestId,
      );
      return context.json(mismatch.body, mismatch.status);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readRepairImageBody(context.req.raw);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
    if (bytes.byteLength !== token.size) {
      const failure = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "content-type-mismatch" },
        requestId,
      );
      return context.json(failure.body, failure.status);
    }
    let uploadClaimed = false;
    try {
      await services.sandboxDatabase.claimRepairImageUpload({
        declaredContentType: token.contentType,
        intentId: token.intentId,
        quarantineObjectKey: token.objectKey,
        repairId: token.repairId,
        sandboxId: token.sandboxId,
        size: token.size,
      });
      uploadClaimed = true;
      await services.repairImageStorage.put(token.objectKey, bytes);
      await services.sandboxDatabase.completeRepairImageUpload({
        intentId: token.intentId,
        sandboxId: token.sandboxId,
      });
      return context.body(null, 204);
    } catch (error) {
      if (uploadClaimed) {
        await cleanOrQueueRepairImageObject(services, {
          key: token.objectKey,
          reason: "failed-direct-upload-object",
          sandboxId: token.sandboxId,
        });
        await services.sandboxDatabase
          .failRepairImageIntent({
            intentId: token.intentId,
            reason: "upload-failed",
            sandboxId: token.sandboxId,
          })
          .catch(() => undefined);
      }
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post(
    "/api/v1/repairs/:repairId/images/intents/:intentId/complete",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (
        !services.sandboxDatabase ||
        !services.sessionSecret ||
        !services.repairImageSigningSecret ||
        !services.repairImageStorage
      ) {
        const unavailable = repairFailure(null, requestId);
        return context.json(unavailable.body, unavailable.status);
      }
      const session = repairSession(context, services);
      if (!session) {
        return context.json(
          errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
          401,
        );
      }
      const fence = await repairWriteFence(
        context,
        services,
        requestId,
        session,
      );
      if (fence) return fence;
      const repairId = context.req.param("repairId");
      const intentId = context.req.param("intentId");
      if (!UUID_V4_PATTERN.test(repairId) || !UUID_V4_PATTERN.test(intentId)) {
        const invalid = repairFailure(
          { code: "REPAIR_IMAGE_CONFLICT", reason: "intent-invalid" },
          requestId,
        );
        return context.json(invalid.body, invalid.status);
      }
      let quarantineObjectKey: string | null = null;
      let finalized = false;
      try {
        const intent =
          await services.sandboxDatabase.prepareRepairImageCompletion({
            ...repairContext(session, repairId),
            intentId,
          });
        quarantineObjectKey = intent.quarantineObjectKey;
        const original =
          await services.repairImageStorage.get(quarantineObjectKey);
        if (!original) {
          throw {
            code: "REPAIR_IMAGE_CONFLICT",
            reason: "upload-not-staged",
          };
        }
        const sanitized = await sanitizeRepairImage({
          bytes: original,
          contentType: intent.declaredContentType,
        });
        const finalObjectKey = `finished/${session.sandboxId}/${sanitized.objectName}`;
        await services.sandboxDatabase.enqueueRepairImageCleanup({
          availableAt: new Date(
            services.wallClock.now().getTime() + REPAIR_IMAGE_ORPHAN_GRACE_MS,
          ),
          objectKey: finalObjectKey,
          reason: "unadopted-finished-object",
          sandboxId: session.sandboxId,
          targetKind: "object",
        });
        await services.repairImageStorage.put(finalObjectKey, sanitized.bytes);
        const image = await services.sandboxDatabase.finalizeRepairImage({
          ...repairContext(session, repairId),
          byteSize: sanitized.bytes.byteLength,
          contentType: sanitized.contentType,
          height: sanitized.height,
          intentId,
          objectKey: finalObjectKey,
          requestId,
          width: sanitized.width,
        });
        finalized = true;
        await cleanOrQueueRepairImageObject(services, {
          key: quarantineObjectKey,
          reason: "consumed-quarantine-object",
          sandboxId: session.sandboxId,
        });
        return context.json(
          {
            image: {
              byteSize: image.byteSize,
              contentType: image.contentType,
              createdAt: image.createdAt.toISOString(),
              height: image.height,
              imageId: image.imageId,
              readUrl: readUrl(services, image),
              source: "uploaded",
              status: "saved",
              width: image.width,
            },
            intentStatus: "consumed",
          } satisfies RepairImageCompletionResponse,
          201,
        );
      } catch (error) {
        if (quarantineObjectKey && !finalized) {
          await cleanOrQueueRepairImageObject(services, {
            key: quarantineObjectKey,
            reason: "failed-completion-quarantine-object",
            sandboxId: session.sandboxId,
          });
          await services.sandboxDatabase
            .failRepairImageIntent({
              intentId,
              reason:
                error instanceof RepairImageSanitizationError
                  ? "sanitization-failed"
                  : "completion-failed",
              sandboxId: session.sandboxId,
            })
            .catch(() => undefined);
        }
        const failure = repairFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    },
  );

  app.get("/api/v1/repairs/:repairId/images", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "private, no-store");
    if (
      !services.sandboxDatabase ||
      !services.sessionSecret ||
      !services.repairImageSigningSecret
    ) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    const repairId = context.req.param("repairId");
    if (!session || !UUID_V4_PATTERN.test(repairId)) {
      const failure = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "not-found" },
        requestId,
      );
      return context.json(failure.body, failure.status);
    }
    try {
      const images = await services.sandboxDatabase.readRepairImages(
        repairContext(session, repairId),
      );
      return context.json({
        images: images.map((image) =>
          image.source === "sample"
            ? {
                byteSize: image.byteSize,
                contentType: image.contentType,
                createdAt: image.createdAt.toISOString(),
                height: image.height,
                imageId: image.imageId,
                sampleAssetId: image.sampleAssetId,
                source: "sample" as const,
                status: "saved" as const,
                width: image.width,
              }
            : {
                byteSize: image.byteSize,
                contentType: image.contentType,
                createdAt: image.createdAt.toISOString(),
                height: image.height,
                imageId: image.imageId,
                readUrl: readUrl(services, image),
                source: "uploaded" as const,
                status: "saved" as const,
                width: image.width,
              },
        ),
        status: "ready",
      } satisfies RepairImageListResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/repair-images/:imageId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Security-Policy", "default-src 'none'");
    context.header("X-Content-Type-Options", "nosniff");
    if (
      !services.sandboxDatabase ||
      !services.sessionSecret ||
      !services.repairImageSigningSecret ||
      !services.repairImageStorage
    ) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const session = repairSession(context, services);
    const imageId = context.req.param("imageId");
    const token = verifyRepairImageToken(
      context.req.query("token"),
      services.repairImageSigningSecret,
    );
    if (
      !session ||
      token?.kind !== "repair-read" ||
      token.imageId !== imageId ||
      token.sandboxId !== session.sandboxId ||
      token.expiresAt <= services.wallClock.now().getTime()
    ) {
      const failure = repairFailure(
        { code: "REPAIR_IMAGE_CONFLICT", reason: "not-found" },
        requestId,
      );
      return context.json(failure.body, failure.status);
    }
    try {
      const image = await services.sandboxDatabase.readRepairImage({
        contextVersion: session.contextVersion,
        imageId,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      const bytes = await services.repairImageStorage.get(image.objectKey);
      if (!bytes) {
        const missing = repairFailure(
          { code: "REPAIR_IMAGE_CONFLICT", reason: "not-found" },
          requestId,
        );
        return context.json(missing.body, missing.status);
      }
      context.header("Content-Type", image.contentType);
      context.header(
        "Content-Disposition",
        `inline; filename="${image.imageId}.${image.contentType === "image/jpeg" ? "jpg" : image.contentType.slice(6)}"`,
      );
      return context.body(new Uint8Array(bytes).buffer);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/staff/repair-intake", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    try {
      const result = await services.sandboxDatabase.readStaffRepairIntake({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role === "manager" ? "manager" : "staff",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        handlers: result.handlers,
        seats: result.seats,
        status: "ready",
        store: result.store,
      } satisfies StaffRepairIntakeResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/staff/repairs", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    try {
      const result = await services.sandboxDatabase.readStaffRepairQueue({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role === "manager" ? "manager" : "staff",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        currentTime: result.currentTime.toISOString(),
        rows: result.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
        status: "ready",
        store: result.store,
      } satisfies StaffRepairQueueResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/staff/repairs", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await staffWriteFence(
      context,
      services,
      requestId,
      auth.session,
    );
    if (fence.response) return fence.response;
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const allowed = new Set(["description", "seatId"]);
    const description =
      typeof body?.description === "string"
        ? normalizeRepairDescription(body.description)
        : null;
    if (
      !body ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      !UUID_V4_PATTERN.test(String(body.seatId ?? "")) ||
      !description
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_INTAKE_CONFLICT", reason: "description-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    try {
      const request = body as unknown as CreateStaffRepairRequest;
      const result = await services.sandboxDatabase.createStaffRepair({
        contextVersion: auth.session.contextVersion,
        description,
        idempotencyKey: fence.idempotencyKey!,
        personaId: auth.session.personaId,
        requestId,
        role: auth.session.role === "manager" ? "manager" : "staff",
        sandboxId: auth.session.sandboxId,
        seatId: request.seatId,
      });
      return context.json(
        {
          ...result,
          createdAt: result.createdAt.toISOString(),
        } satisfies RepairCreatedResponse,
        result.duplicate ? 200 : 201,
      );
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  for (const action of ["assign", "start"] as const) {
    app.post(`/api/v1/staff/repairs/:repairId/${action}`, async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const unavailable = repairFailure(null, requestId);
        return context.json(unavailable.body, unavailable.status);
      }
      const auth = await staffSession(context, services, requestId);
      if (!auth.session) return auth.response;
      const fence = await staffWriteFence(
        context,
        services,
        requestId,
        auth.session,
      );
      if (fence.response) return fence.response;
      const repairId = context.req.param("repairId");
      const parsed: unknown = await context.req.json().catch(() => null);
      const body = isPlainRecord(parsed) ? parsed : null;
      const allowed =
        action === "assign"
          ? new Set([
              "assigneePersonaId",
              "internalNote",
              "priority",
              "publicNote",
            ])
          : new Set(["internalNote", "publicNote"]);
      const publicNote =
        typeof body?.publicNote === "string"
          ? normalizeRepairDescription(body.publicNote)
          : null;
      const internalNote =
        typeof body?.internalNote === "string"
          ? normalizeRepairDescription(body.internalNote)
          : null;
      const validAssign =
        action === "start" ||
        (UUID_V4_PATTERN.test(String(body?.assigneePersonaId ?? "")) &&
          (body?.priority === "normal" ||
            body?.priority === "high" ||
            body?.priority === "urgent"));
      if (
        !UUID_V4_PATTERN.test(repairId) ||
        !body ||
        Object.keys(body).some((key) => !allowed.has(key)) ||
        !publicNote ||
        !internalNote ||
        !validAssign
      ) {
        const invalid = repairFailure(
          { code: "REPAIR_COMMAND_CONFLICT", reason: "note-invalid" },
          requestId,
        );
        return context.json(invalid.body, invalid.status);
      }
      try {
        const request = body as unknown as
          AssignRepairRequest | StartRepairRequest;
        const result = await services.sandboxDatabase.executeRepairCommand({
          action,
          assigneePersonaId:
            action === "assign"
              ? (request as AssignRepairRequest).assigneePersonaId
              : null,
          contextVersion: auth.session.contextVersion,
          idempotencyKey: fence.idempotencyKey!,
          internalNote,
          personaId: auth.session.personaId,
          priority:
            action === "assign"
              ? (request as AssignRepairRequest).priority
              : null,
          publicNote,
          repairId,
          requestId,
          role: auth.session.role === "manager" ? "manager" : "staff",
          sandboxId: auth.session.sandboxId,
        });
        return context.json({
          ...result,
          occurredAt: result.occurredAt.toISOString(),
        } satisfies RepairCommandResponse);
      } catch (error) {
        const failure = repairFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    });
  }

  for (const action of ["claim", "return"] as const) {
    app.post(
      `/api/v1/staff/repairs/:repairId/spares/${action}`,
      async (context) => {
        const requestId = randomUUID();
        context.header("X-Request-Id", requestId);
        context.header("Cache-Control", "no-store");
        if (!services.sandboxDatabase || !services.sessionSecret) {
          const unavailable = repairFailure(null, requestId);
          return context.json(unavailable.body, unavailable.status);
        }
        const auth = await staffSession(context, services, requestId);
        if (!auth.session) return auth.response;
        const fence = await staffWriteFence(
          context,
          services,
          requestId,
          auth.session,
        );
        if (fence.response) return fence.response;
        const repairId = context.req.param("repairId");
        const parsed: unknown = await context.req.json().catch(() => null);
        const body = isPlainRecord(parsed) ? parsed : null;
        const allowed =
          action === "claim"
            ? new Set(["inventoryItemId", "quantity"])
            : new Set(["quantity", "usageId"]);
        const quantity = Number(body?.quantity);
        const targetId = String(
          action === "claim"
            ? (body?.inventoryItemId ?? "")
            : (body?.usageId ?? ""),
        );
        if (
          !UUID_V4_PATTERN.test(repairId) ||
          !body ||
          Object.keys(body).some((key) => !allowed.has(key)) ||
          !Number.isSafeInteger(quantity) ||
          quantity <= 0 ||
          !UUID_V4_PATTERN.test(targetId)
        ) {
          const invalid = repairFailure(
            { code: "REPAIR_COMMAND_CONFLICT", reason: "quantity-invalid" },
            requestId,
          );
          return context.json(invalid.body, invalid.status);
        }
        try {
          const request = body as unknown as
            ClaimRepairSpareRequest | ReturnRepairSpareRequest;
          const result =
            await services.sandboxDatabase.executeRepairSpareCommand({
              action,
              contextVersion: auth.session.contextVersion,
              idempotencyKey: fence.idempotencyKey!,
              inventoryItemId:
                action === "claim"
                  ? (request as ClaimRepairSpareRequest).inventoryItemId
                  : null,
              personaId: auth.session.personaId,
              quantity,
              repairId,
              requestId,
              role: auth.session.role === "manager" ? "manager" : "staff",
              sandboxId: auth.session.sandboxId,
              usageId:
                action === "return"
                  ? (request as ReturnRepairSpareRequest).usageId
                  : null,
            });
          return context.json({
            ...result,
            businessOccurredAt: result.businessOccurredAt.toISOString(),
            recordedAt: result.recordedAt.toISOString(),
          } satisfies RepairSpareCommandResponse);
        } catch (error) {
          const failure = repairFailure(error, requestId);
          return context.json(failure.body, failure.status);
        }
      },
    );
  }

  app.post("/api/v1/staff/repairs/:repairId/resolution", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await staffWriteFence(
      context,
      services,
      requestId,
      auth.session,
    );
    if (fence.response) return fence.response;
    const repairId = context.req.param("repairId");
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const resolutionNote =
      typeof body?.resolutionNote === "string"
        ? normalizeRepairDescription(body.resolutionNote)
        : null;
    if (
      !UUID_V4_PATTERN.test(repairId) ||
      !body ||
      Object.keys(body).some((key) => key !== "resolutionNote") ||
      !resolutionNote
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_COMMAND_CONFLICT", reason: "note-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    try {
      const request = body as unknown as SubmitRepairResolutionRequest;
      const result =
        await services.sandboxDatabase.executeRepairResolutionCommand({
          contextVersion: auth.session.contextVersion,
          idempotencyKey: fence.idempotencyKey!,
          personaId: auth.session.personaId,
          repairId,
          requestId,
          resolutionNote: request.resolutionNote,
          role: auth.session.role === "manager" ? "manager" : "staff",
          sandboxId: auth.session.sandboxId,
        });
      return context.json({
        ...result,
        occurredAt: result.occurredAt.toISOString(),
        recordedAt: result.recordedAt.toISOString(),
      } satisfies RepairResolutionCommandResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/staff/repairs/:repairId/verification", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await staffWriteFence(
      context,
      services,
      requestId,
      auth.session,
    );
    if (fence.response) return fence.response;
    const repairId = context.req.param("repairId");
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const hasReason = body
      ? Object.prototype.hasOwnProperty.call(body, "reason")
      : false;
    const normalizedReason =
      typeof body?.reason === "string"
        ? normalizeRepairDescription(body.reason)
        : null;
    if (
      !UUID_V4_PATTERN.test(repairId) ||
      !body ||
      Object.keys(body).some((key) => key !== "outcome" && key !== "reason") ||
      (body.outcome !== "failure" && body.outcome !== "success") ||
      (hasReason && typeof body.reason !== "string") ||
      (body.outcome === "failure" && !normalizedReason) ||
      (hasReason && (!normalizedReason || normalizedReason.length > 200))
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_COMMAND_CONFLICT", reason: "note-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    const reason = normalizedReason ?? "独立复测通过，座位可以恢复使用。";
    try {
      const request = body as unknown as VerifyRepairRequest;
      const result =
        await services.sandboxDatabase.executeRepairVerificationCommand({
          contextVersion: auth.session.contextVersion,
          idempotencyKey: fence.idempotencyKey!,
          outcome: request.outcome,
          personaId: auth.session.personaId,
          reason,
          repairId,
          requestId,
          role: auth.session.role === "manager" ? "manager" : "staff",
          sandboxId: auth.session.sandboxId,
        });
      return context.json({
        ...result,
        occurredAt: result.occurredAt.toISOString(),
        recordedAt: result.recordedAt.toISOString(),
      } satisfies RepairVerificationCommandResponse);
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/customer/repairs", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = repairFailure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await customerSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await writeFence(context, services, requestId, auth.session);
    if (fence.response) return fence.response;
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const allowed = new Set(["description", "reservationId"]);
    const description =
      typeof body?.description === "string"
        ? normalizeRepairDescription(body.description)
        : null;
    if (
      !body ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      !UUID_V4_PATTERN.test(String(body.reservationId ?? "")) ||
      !description
    ) {
      const invalid = repairFailure(
        { code: "REPAIR_INTAKE_CONFLICT", reason: "description-invalid" },
        requestId,
      );
      return context.json(invalid.body, invalid.status);
    }
    try {
      const request = body as unknown as CreateCustomerRepairRequest;
      const result = await services.sandboxDatabase.createCustomerRepair({
        contextVersion: auth.session.contextVersion,
        description,
        idempotencyKey: fence.idempotencyKey!,
        personaId: auth.session.personaId,
        requestId,
        reservationId: request.reservationId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      return context.json(
        {
          ...result,
          createdAt: result.createdAt.toISOString(),
        } satisfies RepairCreatedResponse,
        result.duplicate ? 200 : 201,
      );
    } catch (error) {
      const failure = repairFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });
}
