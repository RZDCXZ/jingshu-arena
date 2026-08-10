import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import sharp from "sharp";

import type {
  RepairImageListResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";
import { readRoleSession } from "./role-session.js";
import { MemoryRepairImageStorage } from "./repair-image-storage.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
let wallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => wallTime },
});
const publicOrigin = "https://arena.example";
const sessionSecret = "ticket-14-repair-intake-session-secret-32-bytes";
const repairImageStorage = new MemoryRepairImageStorage();
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  repairImageSigningSecret: sessionSecret,
  repairImageStorage,
  secureCookies: true,
  sessionSecret,
});
const { Client } = pg;

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

beforeEach(() => {
  wallTime = fixedTime;
});

afterAll(async () => {
  await database.close();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Expected ${name} cookie.`);
  }
  return pair;
}

async function createCustomerSession() {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role: "customer" }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(created.status).toBe(201);
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  const context = (await contextResponse.json()) as RoleContextReadyResponse;
  const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const session = readRoleSession(token, sessionSecret);
  expect(session).not.toBeNull();
  return { context, cookie, sandboxId: session!.sandboxId };
}

async function createStaffSession() {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role: "staff" }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(created.status).toBe(201);
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

async function switchRole(
  session: Awaited<ReturnType<typeof createCustomerSession>>,
  targetRole: "customer" | "hq" | "staff",
) {
  const switched = await app.request("/api/v1/demo/context/switch", {
    body: JSON.stringify({ targetRole }),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      Origin: publicOrigin,
      "X-CSRF-Token": session.context.csrfToken,
    },
    method: "POST",
  });
  expect(switched.status, await switched.clone().text()).toBe(200);
  return {
    context: (await switched.json()) as RoleContextReadyResponse,
    cookie: cookiePair(switched, "jingshu_session"),
    sandboxId: session.sandboxId,
  };
}

function writeHeaders(
  session: Awaited<ReturnType<typeof createCustomerSession>>,
) {
  return {
    "Content-Type": "application/json",
    Cookie: session.cookie,
    "Idempotency-Key": crypto.randomUUID(),
    Origin: publicOrigin,
    "X-CSRF-Token": session.context.csrfToken,
  };
}

async function createInUseReservation() {
  const session = await createCustomerSession();
  const created = await app.request("/api/v1/customer/reservations", {
    body: JSON.stringify({
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: "2026-08-10T12:30:00.000Z",
      seatCode: "A-08",
      storeCode: "prism-flagship",
    }),
    headers: writeHeaders(session),
    method: "POST",
  });
  expect(created.status).toBe(201);
  const reservation = (await created.json()) as { reservationId: string };
  const paid = await app.request(
    `/api/v1/customer/reservations/${reservation.reservationId}/simulated-payment`,
    { body: "{}", headers: writeHeaders(session), method: "POST" },
  );
  expect(paid.status).toBe(200);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      session.sandboxId,
    ]);
    await client.query(
      `update reservations
          set status = 'in-use', arrived_business_at = $3,
              started_business_at = $3
        where sandbox_id = $1 and id = $2`,
      [session.sandboxId, reservation.reservationId, fixedTime],
    );
    await client.query("commit");
  } finally {
    await client.end();
  }
  return { ...session, reservationId: reservation.reservationId };
}

describe("repair intake API", () => {
  it("creates one new repair for the customer's in-use seat and returns the existing repair on duplicate submission", async () => {
    const session = await createInUseReservation();
    const first = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "  耳机右声道无声  ",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const created = (await first.json()) as {
      duplicate: boolean;
      repairId: string;
    };
    expect(created).toMatchObject({
      description: "耳机右声道无声",
      duplicate: false,
      machineProfile: { code: "competitive", displayName: "竞技型" },
      seat: { code: "A-08", operationalStatus: "normal" },
      status: "new",
    });

    const duplicate = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "耳机右声道无声",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(duplicate.status, await duplicate.clone().text()).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      duplicate: true,
      repairId: created.repairId,
      seat: { code: "A-08", operationalStatus: "normal" },
      status: "new",
    });
    const reservationDetail = await app.request(
      `/api/v1/customer/reservations/${session.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    await expect(reservationDetail.json()).resolves.toMatchObject({
      related: {
        repairs: [
          {
            id: created.repairId,
            label: "A-08 · 耳机右声道无声",
            status: "new",
          },
        ],
      },
    });
  });

  it("lets staff choose only a seat in their store and derives its machine profile", async () => {
    const session = await createStaffSession();
    const intakeResponse = await app.request("/api/v1/staff/repair-intake", {
      headers: { Cookie: session.cookie },
    });
    expect(intakeResponse.status, await intakeResponse.clone().text()).toBe(
      200,
    );
    const intake = (await intakeResponse.json()) as {
      seats: Array<{
        code: string;
        id: string;
        machineProfile: { code: string; displayName: string };
        store: { code: string };
      }>;
    };
    expect(intake.seats).toHaveLength(96);
    expect(new Set(intake.seats.map((seat) => seat.store.code))).toEqual(
      new Set(["prism-flagship"]),
    );
    const seat = intake.seats.find((item) => item.code === "A-18");
    expect(seat).toMatchObject({
      machineProfile: { code: "competitive", displayName: "竞技型" },
    });

    const created = await app.request("/api/v1/staff/repairs", {
      body: JSON.stringify({
        description: "显示器间歇闪烁",
        seatId: seat!.id,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      description: "显示器间歇闪烁",
      duplicate: false,
      machineProfile: { code: "competitive", displayName: "竞技型" },
      reservationId: null,
      seat: { code: "A-18", operationalStatus: "normal" },
      source: "staff",
      status: "new",
      store: { code: "prism-flagship" },
    });
    const queue = await app.request("/api/v1/staff/repairs", {
      headers: { Cookie: session.cookie },
    });
    expect(queue.status, await queue.clone().text()).toBe(200);
    await expect(queue.json()).resolves.toMatchObject({
      rows: [
        {
          description: "显示器间歇闪烁",
          seat: { code: "A-18" },
          status: "new",
        },
      ],
      status: "ready",
      store: { code: "prism-flagship" },
    });
  });

  it("sanitizes a scoped one-time direct upload before private signed reading", async () => {
    const session = await createInUseReservation();
    const repairResponse = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "耳机右声道偶发无声",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    const repair = (await repairResponse.json()) as { repairId: string };
    const original = await sharp({
      create: {
        background: { alpha: 1, b: 28, g: 112, r: 174 },
        channels: 4,
        height: 24,
        width: 32,
      },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "Private Person" } } })
      .toBuffer();

    const intentResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: "image/jpeg",
          filename: "现场故障-original.jpg",
          size: original.byteLength,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(intentResponse.status, await intentResponse.clone().text()).toBe(
      201,
    );
    const intent = (await intentResponse.json()) as {
      completeUrl: string;
      intentId: string;
      uploadUrl: string;
    };

    const uploaded = await app.request(intent.uploadUrl, {
      body: original,
      headers: { "Content-Type": "image/jpeg" },
      method: "PUT",
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(204);

    const uploadReplay = await app.request(intent.uploadUrl, {
      body: original,
      headers: { "Content-Type": "image/jpeg" },
      method: "PUT",
    });
    expect(uploadReplay.status, await uploadReplay.clone().text()).toBe(409);

    const originalDelete = repairImageStorage.delete;
    let completed: Response;
    repairImageStorage.delete = async () => {
      throw new Error("simulated-private-object-delete-failure");
    };
    try {
      completed = await app.request(intent.completeUrl, {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookie,
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      });
    } finally {
      repairImageStorage.delete = originalDelete;
    }
    expect(completed.status, await completed.clone().text()).toBe(201);
    const result = (await completed.json()) as {
      image: {
        contentType: string;
        height: number;
        imageId: string;
        readUrl: string;
        status: string;
        width: number;
      };
    };
    expect(result.image).toMatchObject({
      contentType: "image/jpeg",
      height: 24,
      status: "saved",
      width: 32,
    });

    const read = await app.request(result.image.readUrl, {
      headers: { Cookie: session.cookie },
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(read.headers.get("content-disposition")).not.toContain("现场故障");
    const sanitized = Buffer.from(await read.arrayBuffer());
    const metadata = await sharp(sanitized).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(sanitized.includes(Buffer.from("Private Person"))).toBe(false);

    const cleanupJobs = await database.readDueRepairImageCleanupJobs(10);
    expect(cleanupJobs).toEqual([
      expect.objectContaining({
        objectKey: expect.stringMatching(
          new RegExp(`^quarantine/${session.sandboxId}/`, "u"),
        ),
        sandboxId: session.sandboxId,
        targetKind: "object",
      }),
    ]);
    await repairImageStorage.delete(cleanupJobs[0]!.objectKey!);
    await database.completeRepairImageCleanupJob(cleanupJobs[0]!.jobId);

    const otherSandbox = await createCustomerSession();
    const crossSandboxRead = await app.request(result.image.readUrl, {
      headers: { Cookie: otherSandbox.cookie },
    });
    expect(crossSandboxRead.status).toBe(404);

    const replay = await app.request(intent.completeUrl, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(replay.status).toBe(409);

    const listResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}/images`,
      { headers: { Cookie: session.cookie } },
    );
    expect(listResponse.status, await listResponse.clone().text()).toBe(200);
    const listed = (await listResponse.json()) as RepairImageListResponse;
    expect(listed).toMatchObject({
      images: [{ imageId: result.image.imageId, source: "uploaded" }],
      status: "ready",
    });
    const resigned = listed.images[0];
    expect(resigned?.source).toBe("uploaded");
    if (resigned?.source !== "uploaded") {
      throw new Error("Expected re-signed uploaded image.");
    }
    expect(
      (
        await app.request(resigned.readUrl, {
          headers: { Cookie: session.cookie },
        })
      ).status,
    ).toBe(200);

    const auditClient = new Client({ connectionString: databaseUrl });
    await auditClient.connect();
    try {
      const audit = await auditClient.query<{
        id: string;
        request_id: string;
      }>(
        `select id, request_id from audit_events
          where sandbox_id = $1 and object_id = $2
            and action = 'repair.image-saved'`,
        [session.sandboxId, repair.repairId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.request_id).toBe(
        completed.headers.get("x-request-id"),
      );
      expect(audit.rows[0]?.id).not.toBe(audit.rows[0]?.request_id);
    } finally {
      await auditClient.end();
    }

    const staff = await switchRole(session, "staff");
    const staffList = await app.request(
      `/api/v1/repairs/${repair.repairId}/images`,
      { headers: { Cookie: staff.cookie } },
    );
    expect(staffList.status, await staffList.clone().text()).toBe(200);
    const staffImages = (await staffList.json()) as RepairImageListResponse;
    const staffImage = staffImages.images[0];
    expect(staffImage?.source).toBe("uploaded");
    if (staffImage?.source !== "uploaded") {
      throw new Error("Expected staff-visible uploaded image.");
    }
    expect(
      (
        await app.request(staffImage.readUrl, {
          headers: { Cookie: staff.cookie },
        })
      ).status,
    ).toBe(200);

    const hq = await switchRole(staff, "hq");
    const hqList = await app.request(
      `/api/v1/repairs/${repair.repairId}/images`,
      { headers: { Cookie: hq.cookie } },
    );
    expect(hqList.status, await hqList.clone().text()).toBe(200);

    const crossSandboxList = await app.request(
      `/api/v1/repairs/${repair.repairId}/images`,
      { headers: { Cookie: otherSandbox.cookie } },
    );
    expect(crossSandboxList.status).toBe(404);
  });

  it("rejects forged, active, oversized, and cross-sandbox image access while cleaning quarantine", async () => {
    const session = await createInUseReservation();
    const repairResponse = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "显示器出现异常图像",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    const repair = (await repairResponse.json()) as { repairId: string };

    const activeContent = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const activeIntent = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: "image/svg+xml",
          filename: "active.svg",
          size: activeContent.byteLength,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(activeIntent.status).toBe(422);

    const jpeg = await sharp({
      create: {
        background: "#ff2d55",
        channels: 3,
        height: 18,
        width: 18,
      },
    })
      .jpeg()
      .toBuffer();
    const forgedIntentResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: "image/png",
          filename: "forged.png",
          size: jpeg.byteLength,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    const forgedIntent = (await forgedIntentResponse.json()) as {
      completeUrl: string;
      uploadUrl: string;
    };
    const forgedUpload = await app.request(forgedIntent.uploadUrl, {
      body: jpeg,
      headers: { "Content-Type": "image/png" },
      method: "PUT",
    });
    expect(forgedUpload.status).toBe(204);
    const forgedCompletion = await app.request(forgedIntent.completeUrl, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(forgedCompletion.status).toBe(422);
    expect(
      repairImageStorage.keys().some((key) => key.startsWith("quarantine/")),
    ).toBe(false);

    const oversizedPixels = await sharp({
      create: {
        background: "#0c0f15",
        channels: 3,
        height: 4_001,
        width: 4_001,
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(oversizedPixels.byteLength).toBeLessThan(5 * 1024 * 1024);
    const oversizedIntentResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: "image/png",
          filename: "oversized.png",
          size: oversizedPixels.byteLength,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    const oversizedIntent = (await oversizedIntentResponse.json()) as {
      completeUrl: string;
      uploadUrl: string;
    };
    expect(
      (
        await app.request(oversizedIntent.uploadUrl, {
          body: oversizedPixels,
          headers: { "Content-Type": "image/png" },
          method: "PUT",
        })
      ).status,
    ).toBe(204);
    const oversizedCompletion = await app.request(oversizedIntent.completeUrl, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(oversizedCompletion.status).toBe(422);
    expect(
      repairImageStorage.keys().some((key) => key.startsWith("quarantine/")),
    ).toBe(false);

    const stillExisting = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "显示器出现异常图像",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(stillExisting.status).toBe(200);
    await expect(stillExisting.json()).resolves.toMatchObject({
      duplicate: true,
      repairId: repair.repairId,
    });
  });

  it("marks an upload claimed before a storage failure as failed", async () => {
    const session = await createInUseReservation();
    const repairResponse = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "鼠标间歇断连",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    const repair = (await repairResponse.json()) as { repairId: string };
    const original = await sharp({
      create: {
        background: "#1f7a8c",
        channels: 3,
        height: 16,
        width: 16,
      },
    })
      .jpeg()
      .toBuffer();
    const intentResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: "image/jpeg",
          filename: "mouse.jpg",
          size: original.byteLength,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    const intent = (await intentResponse.json()) as {
      intentId: string;
      uploadUrl: string;
    };
    const originalPut = repairImageStorage.put;
    let failedUpload: Response;
    repairImageStorage.put = async () => {
      throw new Error("simulated-private-object-write-failure");
    };
    try {
      failedUpload = await app.request(intent.uploadUrl, {
        body: original,
        headers: { "Content-Type": "image/jpeg" },
        method: "PUT",
      });
    } finally {
      repairImageStorage.put = originalPut;
    }
    expect(failedUpload.status).toBe(503);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const stored = await client.query<{
        failure_reason: string;
        status: string;
      }>(
        `select status, failure_reason from repair_upload_intents
          where sandbox_id = $1 and id = $2`,
        [session.sandboxId, intent.intentId],
      );
      expect(stored.rows).toEqual([
        { failure_reason: "upload-failed", status: "failed" },
      ]);
    } finally {
      await client.end();
    }
  });

  it("runs the single-image proxy through the same sanitizer and supports only the built-in sample fallback", async () => {
    const session = await createInUseReservation();
    const repairResponse = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "键盘个别按键无响应",
        reservationId: session.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    const repair = (await repairResponse.json()) as { repairId: string };
    const original = await sharp({
      create: {
        background: "#8b5cf6",
        channels: 3,
        height: 40,
        width: 48,
      },
    })
      .webp()
      .withMetadata({ exif: { IFD0: { Artist: "Proxy Private Name" } } })
      .toBuffer();

    const proxied = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/proxy?filename=keyboard.webp`,
      {
        body: original,
        headers: {
          Cookie: session.cookie,
          "Content-Type": "image/webp",
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(proxied.status, await proxied.clone().text()).toBe(201);
    const proxyResult = (await proxied.json()) as {
      image: { readUrl: string; source: string };
    };
    expect(proxyResult.image.source).toBe("uploaded");
    const proxyRead = await app.request(proxyResult.image.readUrl, {
      headers: { Cookie: session.cookie },
    });
    const proxyBytes = Buffer.from(await proxyRead.arrayBuffer());
    expect((await sharp(proxyBytes).metadata()).exif).toBeUndefined();
    expect(proxyBytes.includes(Buffer.from("Proxy Private Name"))).toBe(false);

    const sampled = await app.request(
      `/api/v1/repairs/${repair.repairId}/images/sample`,
      {
        body: JSON.stringify({ sampleAssetId: "repair-headset-v1" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookie,
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(sampled.status, await sampled.clone().text()).toBe(201);
    await expect(sampled.json()).resolves.toMatchObject({
      image: {
        byteSize: 925729,
        contentType: "image/png",
        height: 720,
        sampleAssetId: "repair-headset-v1",
        source: "sample",
        status: "saved",
        width: 960,
      },
    });

    expect(
      repairImageStorage
        .keys()
        .some((key) => key.startsWith(`finished/${session.sandboxId}/`)),
    ).toBe(true);
    const reset = await app.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(reset.status, await reset.clone().text()).toBe(201);
    expect(
      repairImageStorage
        .keys()
        .some((key) => key.startsWith(`finished/${session.sandboxId}/`)),
    ).toBe(false);
  });
});
