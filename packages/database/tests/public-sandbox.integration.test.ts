import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";
import type { PublicSandboxIdempotencyConflictError } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const database = createPublicSandboxDatabase(databaseUrl);
const { Client } = pg;

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

describe("public sandbox creation", () => {
  it("materializes the fixed three-store world with schema and seed versions", async () => {
    const result = await database.create({
      creationKey: "00000000-0000-4000-8000-000000000003",
      selectedRole: "customer",
      visitorKey: "visitor-000000000003",
    });

    expect(result).toEqual({
      replayed: false,
      sandboxId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      schemaVersion: "16",
      seedVersion: "2026-08-10.9",
      expiresAt: expect.any(Date),
      selectedRole: "customer",
      persona: {
        displayName: "林澈",
        protected: true,
        scope: "浏览三店 · 只管理自己的记录",
      },
      operator: {
        displayName: "竞枢演示经营方",
        city: "栖光市",
      },
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          seatCount: 96,
          businessHours: "24 小时",
        },
        {
          code: "starbridge-standard",
          displayName: "星桥标准店",
          seatCount: 64,
          businessHours: "10:00–次日 02:00",
        },
        {
          code: "apex-new",
          displayName: "极点新店",
          seatCount: 40,
          businessHours: "12:00–24:00",
        },
      ],
      roleContext: {
        sandboxId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        schemaVersion: "16",
        seedVersion: "2026-08-10.9",
        expiresAt: expect.any(Date),
        businessClock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds: 0,
          currentTime: expect.any(Date),
          remainingAdvanceMilliseconds: 86_400_000,
          timeZone: "Asia/Shanghai",
        },
        contextVersion: 1,
        role: "customer",
        persona: {
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          ),
          displayName: "林澈",
          protected: true,
          scope: "浏览三店 · 只管理自己的记录",
          storeId: null,
        },
        storeScope: {
          kind: "customer",
          stores: [
            {
              id: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
              ),
              code: "prism-flagship",
              displayName: "棱镜旗舰店",
            },
            {
              id: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
              ),
              code: "starbridge-standard",
              displayName: "星桥标准店",
            },
            {
              id: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
              ),
              code: "apex-new",
              displayName: "极点新店",
            },
          ],
        },
      },
    });
  });

  it("materializes exact areas, machine profiles, seats and query-derived availability", async () => {
    const created = await database.create({
      creationKey: "00000000-0000-4000-8000-000000000018",
      selectedRole: "customer",
      visitorKey: "visitor-000000000018",
    });
    const context = {
      contextVersion: created.roleContext.contextVersion,
      personaId: created.roleContext.persona.id,
      role: created.roleContext.role,
      sandboxId: created.sandboxId,
    } as const;

    const catalog = await database.readCustomerStoreCatalog(context);
    expect(catalog.city).toBe("栖光市");
    expect(catalog.stores.map((store) => store.seatCount)).toEqual([
      96, 64, 40,
    ]);
    expect(
      catalog.stores.map((store) =>
        store.machineProfiles.map((profile) => profile.seatCount),
      ),
    ).toEqual([
      [40, 40, 16],
      [32, 24, 8],
      [24, 12, 4],
    ]);
    expect(catalog.stores[0]?.areas).toHaveLength(4);

    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "immediate",
      storeCode: "prism-flagship",
    });
    expect(availability.seats).toHaveLength(16);
    expect(availability.seats.map((seat) => seat.availability)).toEqual(
      expect.arrayContaining([
        "available",
        "in-use",
        "maintenance",
        "reserved",
      ]),
    );
    expect(availability.price.segments).toHaveLength(4);
    expect(Number.isInteger(availability.price.totalCents)).toBe(true);

    await expect(
      database.readCustomerSeatAvailability({
        ...context,
        areaCode: "standard-zone",
        durationHours: 2,
        machineProfileCode: "competitive",
        mode: "immediate",
        storeCode: "prism-flagship",
      }),
    ).rejects.toMatchObject({ reason: "price-plan-not-found" });
  });

  it("creates one atomic ten-minute hold with immutable price and coupon snapshots and replays it", async () => {
    const created = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const command = {
      areaCode: "competitive-a",
      contextVersion: created.roleContext.contextVersion,
      couponId: null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive" as const,
      mode: "immediate" as const,
      personaId: created.roleContext.persona.id,
      requestId: randomUUID(),
      role: created.roleContext.role,
      sandboxId: created.sandboxId,
      seatCode: "A-08",
      storeCode: "prism-flagship",
    };
    const preview = await database.readCustomerSeatAvailability(command);
    const coupon = preview.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    expect(coupon).toBeDefined();

    const first = await database.createCustomerPendingReservation({
      ...command,
      couponId: coupon?.id ?? null,
    });
    const replay = await database.createCustomerPendingReservation({
      ...command,
      couponId: coupon?.id ?? null,
    });

    expect(first).toMatchObject({
      replayed: false,
      status: "pending-confirmation",
      snapshot: {
        area: { code: "competitive-a", displayName: "竞技区 A" },
        coupon: { code: "reservation-six", discountCents: 600 },
        machineProfile: { code: "competitive" },
        price: {
          discountCents: 600,
          payableCents: preview.price.totalCents - 600,
          subtotalCents: preview.price.totalCents,
        },
        seat: { code: "A-08" },
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      },
    });
    const holdOffset =
      first.holdExpiresAt.getTime() -
      created.roleContext.businessClock.currentTime.getTime();
    expect(holdOffset).toBeGreaterThanOrEqual(10 * 60_000);
    expect(holdOffset).toBeLessThan(10 * 60_000 + 1_000);
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      database.createCustomerPendingReservation({
        ...command,
        couponId: null,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT",
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const persisted = await client.query<{
        audit_count: string;
        coupon_status: string;
        event_count: string;
      }>(
        `select
           (select count(*)::text from audit_events where object_id = $1) as audit_count,
           (select count(*)::text from reservation_business_events where reservation_id = $1) as event_count,
           (select status from experience_coupons where reserved_reservation_id = $1) as coupon_status`,
        [first.reservationId],
      );
      expect(persisted.rows).toEqual([
        { audit_count: "1", coupon_status: "reserved", event_count: "1" },
      ]);
      await client.query(
        "update price_plans set base_hourly_cents = base_hourly_cents + 999 where sandbox_id = $1",
        [created.sandboxId],
      );
      const unchangedSnapshot = await client.query<{
        subtotal_cents: string;
      }>(
        `select price_snapshot #>> '{price,subtotalCents}' as subtotal_cents
           from reservations where id = $1`,
        [first.reservationId],
      );
      expect(unchangedSnapshot.rows).toEqual([
        { subtotal_cents: String(preview.price.totalCents) },
      ]);
    } finally {
      await client.end();
    }
  });

  it("lets only one of twenty same-seat commands win and one cross-store customer hold survive", async () => {
    const sameSeatWorld = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      areaCode: "competitive-a",
      contextVersion: sameSeatWorld.roleContext.contextVersion,
      couponId: null,
      durationHours: 2,
      machineProfileCode: "competitive" as const,
      mode: "immediate" as const,
      personaId: sameSeatWorld.roleContext.persona.id,
      role: sameSeatWorld.roleContext.role,
      sandboxId: sameSeatWorld.sandboxId,
      seatCode: "A-08",
      storeCode: "prism-flagship",
    };
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        database.createCustomerPendingReservation({
          ...context,
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
        }),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(19);

    const crossStoreWorld = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const current = crossStoreWorld.roleContext.businessClock.currentTime;
    const dateKey = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(current);
    const tomorrowNoon = new Date(
      new Date(`${dateKey}T04:00:00.000Z`).getTime() + 24 * 60 * 60_000,
    );
    const shared = {
      contextVersion: crossStoreWorld.roleContext.contextVersion,
      couponId: null,
      durationHours: 2,
      machineProfileCode: "competitive" as const,
      mode: "future" as const,
      personaId: crossStoreWorld.roleContext.persona.id,
      requestedStartsAt: tomorrowNoon,
      role: crossStoreWorld.roleContext.role,
      sandboxId: crossStoreWorld.sandboxId,
    };
    const crossStore = await Promise.allSettled([
      database.createCustomerPendingReservation({
        ...shared,
        areaCode: "competitive-a",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        seatCode: "A-08",
        storeCode: "prism-flagship",
      }),
      database.createCustomerPendingReservation({
        ...shared,
        areaCode: "competitive-lane",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        seatCode: "B-01",
        storeCode: "starbridge-standard",
      }),
    ]);
    expect(
      crossStore.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      crossStore.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
  });

  it("rolls back reservation, coupon, business event, audit and command key when one write fails", async () => {
    const created = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: "visitor-" + randomUUID(),
    });
    const context = {
      areaCode: "competitive-a",
      contextVersion: created.roleContext.contextVersion,
      durationHours: 2,
      machineProfileCode: "competitive" as const,
      mode: "immediate" as const,
      personaId: created.roleContext.persona.id,
      role: created.roleContext.role,
      sandboxId: created.sandboxId,
      seatCode: "A-08",
      storeCode: "prism-flagship",
    };
    const preview = await database.readCustomerSeatAvailability(context);
    const coupon = preview.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    expect(coupon).toBeDefined();
    const command = {
      ...context,
      couponId: coupon?.id ?? null,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    };
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const eventBaseline = await client.query<{ event_count: string }>(
      `select count(*)::text as event_count
         from reservation_business_events
        where sandbox_id = $1`,
      [created.sandboxId],
    );
    await client.query(`
      create function fail_ticket07_reservation_event() returns trigger
      language plpgsql as $$
      begin
        raise exception 'forced reservation event failure';
      end
      $$
    `);
    await client.query(`
      create trigger fail_ticket07_reservation_event
      before insert on reservation_business_events
      for each row execute function fail_ticket07_reservation_event()
    `);

    try {
      await expect(
        database.createCustomerPendingReservation(command),
      ).rejects.toThrow("forced reservation event failure");
    } finally {
      await client.query(
        "drop trigger fail_ticket07_reservation_event on reservation_business_events",
      );
      await client.query("drop function fail_ticket07_reservation_event()");
    }

    const counts = await client.query<{
      audit_count: string;
      command_count: string;
      event_count: string;
      pending_count: string;
      reserved_coupon_count: string;
    }>(
      `select
         (select count(*)::text from reservations
           where sandbox_id = $1 and status = 'pending-confirmation') as pending_count,
         (select count(*)::text from experience_coupons
           where sandbox_id = $1 and status = 'reserved') as reserved_coupon_count,
         (select count(*)::text from reservation_business_events
           where sandbox_id = $1) as event_count,
         (select count(*)::text from audit_events
           where sandbox_id = $1 and action = 'reservation.create') as audit_count,
         (select count(*)::text from reservation_command_requests
           where sandbox_id = $1) as command_count`,
      [created.sandboxId],
    );
    expect(counts.rows).toEqual([
      {
        audit_count: "0",
        command_count: "0",
        event_count: eventBaseline.rows[0]?.event_count ?? "0",
        pending_count: "0",
        reserved_coupon_count: "0",
      },
    ]);
    await client.end();

    await expect(
      database.createCustomerPendingReservation(command),
    ).resolves.toMatchObject({
      replayed: false,
      status: "pending-confirmation",
    });
  });

  it("replays the same successful world for the same creation key and payload", async () => {
    const command = {
      creationKey: "00000000-0000-4000-8000-000000000004",
      selectedRole: "staff" as const,
      visitorKey: "visitor-000000000004",
    };

    const first = await database.create(command);
    const retry = await database.create(command);

    expect(retry).toEqual({
      ...first,
      replayed: true,
      roleContext: {
        ...first.roleContext,
        businessClock: {
          ...first.roleContext.businessClock,
          currentTime: expect.any(Date),
        },
      },
    });
    expect(
      retry.roleContext.businessClock.currentTime.getTime(),
    ).toBeGreaterThanOrEqual(
      first.roleContext.businessClock.currentTime.getTime(),
    );
  });

  it("limits business reads to the active sandbox through Postgres RLS", async () => {
    const firstCreationKey = "00000000-0000-4000-8000-000000000005";
    const first = await database.create({
      creationKey: firstCreationKey,
      selectedRole: "customer",
      visitorKey: "visitor-000000000005",
    });
    const second = await database.create({
      creationKey: "00000000-0000-4000-8000-000000000006",
      selectedRole: "customer",
      visitorKey: "visitor-000000000006",
    });
    const client = new Client({ connectionString: databaseUrl });

    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");

      const storesWithoutSandboxContext = await client.query<{ count: string }>(
        "select count(*)::text as count from stores",
      );
      const auditsWithoutSandboxContext = await client.query<{ count: string }>(
        "select count(*)::text as count from audit_events",
      );
      await client.query("savepoint missing_sandbox_context_write");
      await expect(
        client.query(
          `insert into audit_events (
             id, sandbox_id, persona_id, role, action, object_type,
             result, request_id
           ) values ($1, $2, $3, 'customer', 'role_context.switch',
             'role_context', 'denied', $4)`,
          [
            "00000000-0000-4000-8000-000000000201",
            first.sandboxId,
            first.roleContext.persona.id,
            "00000000-0000-4000-8000-000000000202",
          ],
        ),
      ).rejects.toThrow(/row-level security/iu);
      await client.query("rollback to savepoint missing_sandbox_context_write");

      expect(storesWithoutSandboxContext.rows[0]?.count).toBe("0");
      expect(auditsWithoutSandboxContext.rows[0]?.count).toBe("0");

      await client.query("select set_config('app.sandbox_id', $1, true)", [
        first.sandboxId,
      ]);

      const visibleStores = await client.query<{ sandbox_id: string }>(
        "select sandbox_id from stores order by code",
      );
      const crossSandbox = await client.query<{ count: string }>(
        "select count(*)::text as count from stores where sandbox_id = $1",
        [second.sandboxId],
      );
      const crossSandboxWrite = await client.query(
        "update stores set display_name = '不可见改写' where sandbox_id = $1",
        [second.sandboxId],
      );
      const requestsWithoutCreationKey = await client.query<{ count: string }>(
        "select count(*)::text as count from sandbox_creation_requests",
      );

      await client.query(
        "select set_config('app.creation_key_hash', $1, true)",
        [createHash("sha256").update(firstCreationKey).digest("hex")],
      );
      const visibleRequests = await client.query<{ sandbox_id: string }>(
        "select sandbox_id from sandbox_creation_requests",
      );

      expect(visibleStores.rows).toHaveLength(3);
      expect(
        visibleStores.rows.every((row) => row.sandbox_id === first.sandboxId),
      ).toBe(true);
      expect(crossSandbox.rows[0]?.count).toBe("0");
      expect(crossSandboxWrite.rowCount).toBe(0);
      expect(requestsWithoutCreationKey.rows[0]?.count).toBe("0");
      expect(visibleRequests.rows).toEqual([{ sandbox_id: first.sandboxId }]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });

  it("rejects reuse of a creation key with a different role payload", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000007";
    const visitorKey = "visitor-000000000007";
    await database.create({ creationKey, selectedRole: "staff", visitorKey });

    await expect(
      database.create({ creationKey, selectedRole: "hq", visitorKey }),
    ).rejects.toMatchObject({
      name: "PublicSandboxIdempotencyConflictError",
      code: "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT",
    } satisfies Partial<PublicSandboxIdempotencyConflictError>);
  });

  it("does not let another visitor replay a creation key", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000015";
    await database.create({
      creationKey,
      selectedRole: "customer",
      visitorKey: "visitor-owner-000000000015",
    });

    await expect(
      database.create({
        creationKey,
        selectedRole: "customer",
        visitorKey: "visitor-intruder-000000000015",
      }),
    ).rejects.toMatchObject({
      code: "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT",
      name: "PublicSandboxOwnershipConflictError",
    });
  });

  it("lets a legacy request claim its visitor binding during the 24-hour expand window", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000017";
    const original = await database.create({
      creationKey,
      selectedRole: "customer",
      visitorKey: "pre-expand-placeholder-000000000017",
    });
    const client = new Client({ connectionString: databaseUrl });

    await client.connect();
    try {
      await client.query(
        `update sandbox_creation_requests
            set visitor_key_hash = null
          where creation_key_hash = $1`,
        [createHash("sha256").update(creationKey).digest("hex")],
      );
      await client.query(
        `update sandboxes
            set role_context_role = null
          where id = $1`,
        [original.sandboxId],
      );
    } finally {
      await client.end();
    }

    const upgraded = await database.create({
      creationKey,
      selectedRole: "customer",
      visitorKey: "upgraded-visitor-000000000017",
    });

    expect(upgraded).toEqual({
      ...original,
      replayed: true,
      roleContext: {
        ...original.roleContext,
        businessClock: {
          ...original.roleContext.businessClock,
          currentTime: expect.any(Date),
        },
      },
    });

    const claimed = new Client({ connectionString: databaseUrl });
    await claimed.connect();
    try {
      const role = await claimed.query<{ role_context_role: string | null }>(
        "select role_context_role from sandboxes where id = $1",
        [original.sandboxId],
      );
      expect(role.rows).toEqual([{ role_context_role: "customer" }]);
    } finally {
      await claimed.end();
    }
  });

  it("rolls back the whole world when seed materialization fails", async () => {
    const command = {
      creationKey: "00000000-0000-4000-8000-000000000008",
      selectedRole: "manager" as const,
      visitorKey: "visitor-000000000008",
    };
    const client = new Client({ connectionString: databaseUrl });

    await client.connect();
    await client.query(`
      create function fail_public_sandbox_store_seed() returns trigger
      language plpgsql as $$
      begin
        if new.code = 'apex-new' then
          raise exception 'forced public sandbox seed failure';
        end if;
        return new;
      end
      $$
    `);
    await client.query(`
      create trigger fail_public_sandbox_store_seed
      before insert on stores
      for each row execute function fail_public_sandbox_store_seed()
    `);

    try {
      await expect(database.create(command)).rejects.toThrow(
        "forced public sandbox seed failure",
      );
    } finally {
      await client.query(
        "drop trigger fail_public_sandbox_store_seed on stores",
      );
      await client.query("drop function fail_public_sandbox_store_seed() ");
      await client.end();
    }

    const retry = await database.create(command);
    expect(retry.replayed).toBe(false);
    expect(retry.stores).toHaveLength(3);
  });
});
