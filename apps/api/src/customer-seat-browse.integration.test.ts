import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedBusinessTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedBusinessTime },
});
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-06-integration-session-secret-32-bytes",
  secureCookies: true,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

async function createRoleSession(role: "customer" | "staff") {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie =
    visitor.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const response = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

describe("customer store and seat browsing API", () => {
  it("returns the exact three-store catalog and a derived immediate seat/price preview", async () => {
    const cookie = await createRoleSession("customer");
    const catalog = await app.request("/api/v1/customer/stores", {
      headers: { Cookie: cookie },
    });
    expect(catalog.status).toBe(200);
    await expect(catalog.json()).resolves.toMatchObject({
      status: "ready",
      city: "栖光市",
      currentTime: fixedBusinessTime.toISOString(),
      bookingRules: {
        durationHours: { maximum: 8, minimum: 1 },
        futureDays: 7,
        halfHourAligned: true,
        immediateUsesCurrentSegment: true,
      },
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          seatCount: 96,
          businessHours: "24 小时",
          areas: expect.arrayContaining([
            { code: "competitive-a", displayName: "竞技区 A", seatCount: 24 },
          ]),
          machineProfiles: [
            expect.objectContaining({ code: "standard", seatCount: 40 }),
            expect.objectContaining({ code: "competitive", seatCount: 40 }),
            expect.objectContaining({ code: "flagship", seatCount: 16 }),
          ],
        },
        expect.objectContaining({ displayName: "星桥标准店", seatCount: 64 }),
        expect.objectContaining({ displayName: "极点新店", seatCount: 40 }),
      ],
    });

    const query = new URLSearchParams({
      area: "competitive-a",
      durationHours: "2",
      machine: "competitive",
      mode: "immediate",
      store: "prism-flagship",
    });
    const availability = await app.request(
      `/api/v1/customer/seat-availability?${query.toString()}`,
      { headers: { Cookie: cookie } },
    );
    expect(availability.status).toBe(200);
    await expect(availability.json()).resolves.toMatchObject({
      status: "ready",
      window: {
        startsAt: "2026-08-10T11:30:00.000Z",
        endsAt: "2026-08-10T13:30:00.000Z",
        mode: "immediate",
      },
      seats: expect.arrayContaining([
        expect.objectContaining({ availability: "available" }),
        expect.objectContaining({ availability: "reserved" }),
        expect.objectContaining({ availability: "in-use" }),
        expect.objectContaining({ availability: "maintenance" }),
      ]),
      price: {
        baseHourlyCents: 1_500,
        totalCents: 3_600,
        segments: [
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
        ],
      },
    });
  });

  it("rejects invalid booking boundaries and non-customer role contexts", async () => {
    const customerCookie = await createRoleSession("customer");
    const invalidQuery = new URLSearchParams({
      area: "competitive-a",
      durationHours: "2",
      machine: "competitive",
      mode: "future",
      start: "2026-08-10T12:15:00.000Z",
      store: "prism-flagship",
    });
    const invalid = await app.request(
      `/api/v1/customer/seat-availability?${invalidQuery.toString()}`,
      { headers: { Cookie: customerCookie } },
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_BOOKING_HALF_HOUR_ALIGNMENT" },
    });

    const staffCookie = await createRoleSession("staff");
    const forbidden = await app.request("/api/v1/customer/stores", {
      headers: { Cookie: staffCookie },
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_ROLE_REQUIRED" },
    });
  });

  it("prices a future weekend window across midnight inside store hours", async () => {
    const cookie = await createRoleSession("customer");
    const query = new URLSearchParams({
      area: "competitive-lane",
      durationHours: "2",
      machine: "competitive",
      mode: "future",
      start: "2026-08-15T15:30:00.000Z",
      store: "starbridge-standard",
    });
    const response = await app.request(
      `/api/v1/customer/seat-availability?${query.toString()}`,
      { headers: { Cookie: cookie } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      price: {
        baseHourlyCents: 1_200,
        segments: [
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
        ],
        totalCents: 2_760,
      },
      window: {
        endsAt: "2026-08-15T17:30:00.000Z",
        mode: "future",
        startsAt: "2026-08-15T15:30:00.000Z",
      },
    });
  });
});
