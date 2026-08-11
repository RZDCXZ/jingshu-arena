import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const sql = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
  await sql.end();
});

async function createManagerContext() {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: "manager",
    visitorKey: `visitor-${randomUUID()}`,
  });
  return {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role: "manager" as const,
    sandboxId: world.sandboxId,
  };
}

async function createHeadquartersContext() {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: "hq",
    visitorKey: `visitor-${randomUUID()}`,
  });
  return {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role: "hq" as const,
    sandboxId: world.sandboxId,
  };
}

describe("manager store configuration", () => {
  it("keeps headquarters reads and writes inside the canonical fixed three stores", async () => {
    const context = await createHeadquartersContext();
    const unknownStoreId = randomUUID();
    const operator = await sql.query<{ id: string }>(
      `select id from operators where sandbox_id = $1`,
      [context.sandboxId],
    );
    await sql.query(
      `insert into stores (
         id, sandbox_id, operator_id, code, display_name, fictitious_city,
         introduction, seat_count, opens_at, closes_at, is_open_24_hours
       ) values ($1, $2, $3, 'unknown-fourth', '非规范第四店', '栖光市（虚构）',
         '这家店只用于验证总部固定三店边界。', 1, '00:00', '00:00', true)`,
      [unknownStoreId, context.sandboxId, operator.rows[0]!.id],
    );

    const catalogs = await database.readHeadquartersCatalogs(context);
    expect(catalogs.stores.map((store) => store.code)).toEqual([
      "prism-flagship",
      "starbridge-standard",
      "apex-new",
    ]);
    const people = await database.readHeadquartersPeopleSchedule(context);
    expect(people.stores.map((store) => store.store.code)).toEqual([
      "prism-flagship",
      "starbridge-standard",
      "apex-new",
    ]);
    const readRequestId = randomUUID();
    await expect(
      database.readManagerStoreConfiguration({
        ...context,
        requestId: readRequestId,
        storeId: unknownStoreId,
      }),
    ).rejects.toMatchObject({ reason: "cross-store" });
    const readDenial = await sql.query<{
      reason: string;
      role: string;
      store_id: string | null;
    }>(
      `select store_id, role, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, readRequestId],
    );
    expect(readDenial.rows).toEqual([
      { reason: "cross-store", role: "hq", store_id: null },
    ]);

    const prismStore = catalogs.stores.find(
      (store) => store.code === "prism-flagship",
    )!;
    const configuration = await database.readManagerStoreConfiguration({
      ...context,
      storeId: prismStore.storeId,
    });
    const product = configuration.products[0]!;
    const productRequestId = randomUUID();
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-product",
        expectedVersion: product.version,
        idempotencyKey: randomUUID(),
        listed: product.listed,
        lowStockThreshold: product.lowStockThreshold + 1,
        requestId: productRequestId,
        storeId: prismStore.storeId,
        storeProductId: product.storeProductId,
        unitPriceCents: product.unitPriceCents,
      }),
    ).rejects.toMatchObject({ reason: "capability-denied" });
    const unchanged = await database.readManagerStoreConfiguration({
      ...context,
      storeId: prismStore.storeId,
    });
    expect(
      unchanged.products.find(
        (candidate) => candidate.storeProductId === product.storeProductId,
      )?.lowStockThreshold,
    ).toBe(product.lowStockThreshold);
    const productDenial = await sql.query<{ reason: string; role: string }>(
      `select role, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, productRequestId],
    );
    expect(productDenial.rows).toEqual([
      { reason: "capability-denied", role: "hq" },
    ]);

    const requestId = randomUUID();
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-profile",
        displayName: "不得保存的第四店",
        expectedVersion: 1,
        fictitiousCity: "栖光市（虚构）",
        idempotencyKey: randomUUID(),
        introduction: "总部不能越过固定三店范围。",
        requestId,
        storeId: unknownStoreId,
      }),
    ).rejects.toMatchObject({ reason: "cross-store" });
    const denial = await sql.query<{
      reason: string;
      role: string;
      store_id: string | null;
    }>(
      `select store_id, role, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, requestId],
    );
    expect(denial.rows).toEqual([
      { reason: "cross-store", role: "hq", store_id: null },
    ]);
  });

  it("reads only the manager's fixed store with areas, seats, machine profiles, and dependency counts", async () => {
    const context = await createManagerContext();

    const configuration = await database.readManagerStoreConfiguration(context);

    expect(configuration.store).toMatchObject({
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      fictitiousCity: "栖光市（虚构）",
      fixed: true,
      seatCount: 96,
    });
    expect(configuration.areas).toHaveLength(4);
    expect(configuration.seats).toHaveLength(96);
    expect(
      configuration.machineProfiles.map((profile) => profile.code),
    ).toEqual(["standard", "competitive", "flagship"]);
    expect(
      configuration.seats.some(
        (seat) =>
          seat.dependencies.activeReservations > 0 ||
          seat.dependencies.openRepairs > 0,
      ),
    ).toBe(true);
    expect(configuration.businessHours.current).toMatchObject({
      display: "24 小时",
      isOpen24Hours: true,
    });
    expect(configuration.pricePlans.length).toBeGreaterThan(0);
    expect(configuration.pricePlans[0]).toMatchObject({
      pricingModel: "explicit-half-hour",
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      weekdayHalfHourCents: expect.any(Number),
      weekendHalfHourCents: expect.any(Number),
    });
    expect(configuration.products).toHaveLength(11);
    expect(
      configuration.products.some(
        (product) => product.headquartersProduct.code === "orbit-rice-roll",
      ),
    ).toBe(false);
    expect(configuration.products[0]).toMatchObject({
      availableQuantity: expect.any(Number),
      headquartersProduct: {
        archived: false,
        displayName: expect.any(String),
      },
      lowStockThreshold: expect.any(Number),
      unitPriceCents: expect.any(Number),
    });
  });

  it("creates a future price version, closes the previous range, rejects overlap, and selects the new version", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);
    const existing = before.pricePlans.find(
      (plan) =>
        plan.area.code === "competitive-a" &&
        plan.machineProfile.code === "competitive" &&
        plan.startsAt === "18:00",
    )!;
    const effectiveFrom = new Date("2026-08-10T12:30:00.000Z");
    const idempotencyKey = randomUUID();
    const create = () =>
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-price-plan" as const,
        areaId: existing.area.areaId,
        effectiveFrom,
        endsAt: existing.endsAt,
        endsNextDay: existing.endsNextDay,
        expectedVersion: before.store.version,
        idempotencyKey,
        machineProfileId: existing.machineProfile.machineProfileId,
        requestId: randomUUID(),
        startsAt: existing.startsAt,
        storeId: before.store.storeId,
        weekdayHalfHourCents: 975,
        weekendHalfHourCents: 1_175,
      });

    await expect(create()).resolves.toMatchObject({
      action: "create-price-plan",
      replayed: false,
    });
    await expect(create()).resolves.toMatchObject({
      action: "create-price-plan",
      replayed: true,
    });
    const confirmed = await database.readManagerStoreConfiguration(context);
    const created = confirmed.pricePlans.find(
      (plan) =>
        plan.area.areaId === existing.area.areaId &&
        plan.machineProfile.machineProfileId ===
          existing.machineProfile.machineProfileId &&
        plan.version === existing.version + 1,
    )!;
    expect(created).toMatchObject({
      effectiveFrom,
      effectiveUntil: null,
      status: "scheduled",
      weekdayHalfHourCents: 975,
      weekendHalfHourCents: 1_175,
    });
    expect(
      confirmed.pricePlans.find(
        (plan) => plan.pricePlanId === existing.pricePlanId,
      )?.effectiveUntil,
    ).toEqual(effectiveFrom);

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-price-plan",
        areaId: existing.area.areaId,
        effectiveFrom,
        endsAt: existing.endsAt,
        endsNextDay: existing.endsNextDay,
        expectedVersion: confirmed.store.version,
        idempotencyKey: randomUUID(),
        machineProfileId: existing.machineProfile.machineProfileId,
        requestId: randomUUID(),
        startsAt: existing.startsAt,
        storeId: before.store.storeId,
        weekdayHalfHourCents: 1_000,
        weekendHalfHourCents: 1_200,
      }),
    ).rejects.toMatchObject({ reason: "price-plan-overlap" });

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-price-plan",
        areaId: existing.area.areaId,
        effectiveFrom: new Date("2026-08-10T13:00:00.000Z"),
        endsAt: "23:00",
        endsNextDay: false,
        expectedVersion: confirmed.store.version,
        idempotencyKey: randomUUID(),
        machineProfileId: existing.machineProfile.machineProfileId,
        requestId: randomUUID(),
        startsAt: "19:00",
        storeId: before.store.storeId,
        weekdayHalfHourCents: 1_000,
        weekendHalfHourCents: 1_200,
      }),
    ).rejects.toMatchObject({ reason: "price-plan-overlap" });

    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "archive-price-plan",
      expectedVersion: created.configVersion,
      idempotencyKey: randomUUID(),
      pricePlanId: created.pricePlanId,
      requestId: randomUUID(),
      storeId: before.store.storeId,
    });
    const archived = await database.readManagerStoreConfiguration(context);
    expect(
      archived.pricePlans.find(
        (plan) => plan.pricePlanId === created.pricePlanId,
      )?.status,
    ).toBe("archived");
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-price-plan",
        areaId: existing.area.areaId,
        effectiveFrom,
        endsAt: existing.endsAt,
        endsNextDay: existing.endsNextDay,
        expectedVersion: archived.store.version,
        idempotencyKey: randomUUID(),
        machineProfileId: existing.machineProfile.machineProfileId,
        requestId: randomUUID(),
        startsAt: existing.startsAt,
        storeId: before.store.storeId,
        weekdayHalfHourCents: 975,
        weekendHalfHourCents: 1_175,
      }),
    ).resolves.toMatchObject({ action: "create-price-plan" });

    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const availability = await database.readCustomerSeatAvailability({
      areaCode: existing.area.code,
      contextVersion: customerRole.contextVersion,
      durationHours: 1,
      machineProfileCode: existing.machineProfile.code,
      mode: "future",
      personaId: customerRole.persona.id,
      requestedStartsAt: effectiveFrom,
      role: "customer",
      sandboxId: context.sandboxId,
      storeCode: "prism-flagship",
    });
    expect(
      availability.price.segments.map((segment) => segment.amountCents),
    ).toEqual([975, 975]);
  });

  it("uses the displayed explicit plan for every segment across a clock boundary", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const base = configuration.pricePlans.find(
      (plan) =>
        plan.area.code === "competitive-a" &&
        plan.machineProfile.code === "competitive" &&
        plan.startsAt === "06:00",
    )!;
    const evening = configuration.pricePlans.find(
      (plan) =>
        plan.area.areaId === base.area.areaId &&
        plan.machineProfile.machineProfileId ===
          base.machineProfile.machineProfileId &&
        plan.startsAt === "18:00",
    )!;
    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });

    const availability = await database.readCustomerSeatAvailability({
      areaCode: base.area.code,
      contextVersion: customerRole.contextVersion,
      durationHours: 1,
      machineProfileCode: base.machineProfile.code,
      mode: "future",
      personaId: customerRole.persona.id,
      requestedStartsAt: new Date("2026-08-11T09:30:00.000Z"),
      role: "customer",
      sandboxId: context.sandboxId,
      storeCode: "prism-flagship",
    });

    expect(
      availability.price.segments.map((segment) => segment.amountCents),
    ).toEqual([base.weekdayHalfHourCents, evening.weekdayHalfHourCents]);
  });

  it("updates and archives a store product without changing historical order snapshots", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);
    const product = before.products.find((candidate) => candidate.listed)!;
    const snapshotBefore = await sql.query<{ order_snapshot: unknown }>(
      `select order_snapshot from customer_orders
        where sandbox_id = $1 and store_id = $2
        order by id limit 1`,
      [context.sandboxId, before.store.storeId],
    );
    const idempotencyKey = randomUUID();
    const update = () =>
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-product" as const,
        expectedVersion: product.version,
        idempotencyKey,
        listed: false,
        lowStockThreshold: product.lowStockThreshold + 2,
        requestId: randomUUID(),
        storeId: before.store.storeId,
        storeProductId: product.storeProductId,
        unitPriceCents: product.unitPriceCents + 125,
      });
    await expect(update()).resolves.toMatchObject({
      action: "update-store-product",
      replayed: false,
    });
    await expect(update()).resolves.toMatchObject({ replayed: true });

    const updated = await database.readManagerStoreConfiguration(context);
    const confirmedProduct = updated.products.find(
      (candidate) => candidate.storeProductId === product.storeProductId,
    )!;
    expect(confirmedProduct).toMatchObject({
      listed: false,
      lowStockThreshold: product.lowStockThreshold + 2,
      unitPriceCents: product.unitPriceCents + 125,
    });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "archive-store-product",
      expectedVersion: confirmedProduct.version,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      storeId: before.store.storeId,
      storeProductId: confirmedProduct.storeProductId,
    });
    const archived = await database.readManagerStoreConfiguration(context);
    expect(
      archived.products.find(
        (candidate) => candidate.storeProductId === product.storeProductId,
      ),
    ).toMatchObject({ archived: true, listed: false });
    const snapshotAfter = await sql.query<{ order_snapshot: unknown }>(
      `select order_snapshot from customer_orders
        where sandbox_id = $1 and store_id = $2
        order by id limit 1`,
      [context.sandboxId, before.store.storeId],
    );
    expect(snapshotAfter.rows).toEqual(snapshotBefore.rows);
  });

  it("saves store display information and exposes it to customers only after the server transaction confirms", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);

    const saved = await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-store-profile",
      displayName: "棱镜旗舰演示店",
      expectedVersion: before.store.version,
      fictitiousCity: "新栖光市（虚构）",
      idempotencyKey: randomUUID(),
      introduction: "只使用合成资料的长名称门店介绍，用于确认服务端保存结果。",
      requestId: randomUUID(),
      storeId: before.store.storeId,
    });
    const confirmed = await database.readManagerStoreConfiguration(context);

    expect(saved).toMatchObject({
      action: "update-store-profile",
      replayed: false,
      version: before.store.version + 1,
    });
    expect(confirmed.store).toMatchObject({
      displayName: "棱镜旗舰演示店",
      fictitiousCity: "新栖光市（虚构）",
      introduction: "只使用合成资料的长名称门店介绍，用于确认服务端保存结果。",
    });

    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customerCatalog = await database.readCustomerStoreCatalog({
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer",
      sandboxId: context.sandboxId,
    });
    expect(customerCatalog.stores[0]).toMatchObject({
      displayName: "棱镜旗舰演示店",
      fictitiousCity: "新栖光市（虚构）",
      introduction: "只使用合成资料的长名称门店介绍，用于确认服务端保存结果。",
    });
  });

  it("records only bounded denial metadata and never persists rejected manager free text", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const requestId = randomUUID();

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-profile",
        displayName: "控制字符门店\u0007",
        expectedVersion: configuration.store.version,
        fictitiousCity: "栖光市（虚构）",
        idempotencyKey: randomUUID(),
        introduction: "仅包含合成资料的安全演示介绍。",
        requestId,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "invalid-profile" });

    const denied = await sql.query<{
      after_data: Record<string, unknown>;
      reason: string;
    }>(
      `select after_data, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, requestId],
    );
    expect(denied.rows).toEqual([
      {
        after_data: {
          action: "update-store-profile",
          expectedVersion: configuration.store.version,
          payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          storeId: configuration.store.storeId,
        },
        reason: "invalid-profile",
      },
    ]);
    const serializedAudit = JSON.stringify(denied.rows[0]?.after_data);
    expect(serializedAudit).not.toContain("控制字符门店");
  });

  it("schedules business hours for future bookings without invalidating the current hours", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);
    const effectiveFrom = new Date(fixedTime.getTime() + 30 * 60 * 1_000);

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "schedule-business-hours",
        closesAt: "09:00",
        closesNextDay: false,
        daySet: "all",
        effectiveFrom,
        expectedVersion: before.store.version,
        idempotencyKey: randomUUID(),
        isOpen24Hours: false,
        opensAt: "10:00",
        requestId: randomUUID(),
        storeId: before.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "invalid-business-hours" });

    const saved = await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "schedule-business-hours",
      closesAt: "18:00",
      closesNextDay: false,
      daySet: "all",
      effectiveFrom,
      expectedVersion: before.store.version,
      idempotencyKey: randomUUID(),
      isOpen24Hours: false,
      opensAt: "10:00",
      requestId: randomUUID(),
      storeId: before.store.storeId,
    });
    const confirmed = await database.readManagerStoreConfiguration(context);

    expect(saved).toMatchObject({
      action: "schedule-business-hours",
      replayed: false,
      version: before.store.version + 1,
    });
    expect(confirmed.businessHours.current.display).toBe("24 小时");
    expect(confirmed.businessHours.scheduled).toContainEqual(
      expect.objectContaining({
        closesAt: "18:00",
        daySet: "all",
        effectiveFrom,
        opensAt: "10:00",
      }),
    );

    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customerContext = {
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer" as const,
      sandboxId: context.sandboxId,
    };
    const catalog = await database.readCustomerStoreCatalog(customerContext);
    expect(catalog.stores[0]?.businessHours).toBe("24 小时");
    await expect(
      database.readCustomerSeatAvailability({
        ...customerContext,
        areaCode: "competitive-a",
        durationHours: 1,
        machineProfileCode: "competitive",
        mode: "future",
        requestedStartsAt: new Date("2026-08-10T19:30:00.000Z"),
        storeCode: "prism-flagship",
      }),
    ).rejects.toMatchObject({ reason: "outside-business-hours" });

    const managerRole = await database.switchRoleContext({
      ...customerContext,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const managerContext = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: context.sandboxId,
    };
    await database.advanceDemoTime({
      ...managerContext,
      idempotencyKey: randomUUID(),
      mode: "half-hour",
      requestId: randomUUID(),
    });
    const effectiveManagerConfiguration =
      await database.readManagerStoreConfiguration(managerContext);
    expect(effectiveManagerConfiguration.businessHours.current).toMatchObject({
      closesAt: "18:00",
      display: "10:00–18:00",
      opensAt: "10:00",
    });
    expect(
      effectiveManagerConfiguration.businessHours.effective,
    ).toContainEqual(
      expect.objectContaining({
        daySet: "all",
        effectiveFrom,
      }),
    );
    const effectiveCustomerRole = await database.switchRoleContext({
      ...managerContext,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const effectiveCustomerCatalog = await database.readCustomerStoreCatalog({
      contextVersion: effectiveCustomerRole.contextVersion,
      personaId: effectiveCustomerRole.persona.id,
      role: "customer",
      sandboxId: context.sandboxId,
    });
    expect(effectiveCustomerCatalog.stores[0]?.businessHours).toBe(
      "10:00–18:00",
    );
  });

  it("keeps the baseline visible and uses it when a weekday-only version does not cover the weekend", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const effectiveFrom = new Date(fixedTime.getTime() + 30 * 60 * 1_000);
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "schedule-business-hours",
      closesAt: "18:00",
      closesNextDay: false,
      daySet: "weekdays",
      effectiveFrom,
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      isOpen24Hours: false,
      opensAt: "10:00",
      requestId: randomUUID(),
      storeId: configuration.store.storeId,
    });
    await database.advanceDemoTime({
      ...context,
      idempotencyKey: randomUUID(),
      mode: "half-hour",
      requestId: randomUUID(),
    });

    const effectiveConfiguration =
      await database.readManagerStoreConfiguration(context);
    expect(effectiveConfiguration.businessHours.baseline).toMatchObject({
      display: "24 小时",
      isOpen24Hours: true,
    });
    expect(effectiveConfiguration.businessHours.effective).toEqual([
      expect.objectContaining({ daySet: "weekdays", effectiveFrom }),
    ]);

    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const weekendAvailability = await database.readCustomerSeatAvailability({
      areaCode: "competitive-a",
      contextVersion: customerRole.contextVersion,
      durationHours: 1,
      machineProfileCode: "competitive",
      mode: "future",
      personaId: customerRole.persona.id,
      requestedStartsAt: new Date("2026-08-16T17:00:00.000Z"),
      role: "customer",
      sandboxId: context.sandboxId,
      storeCode: "prism-flagship",
    });
    expect(weekendAvailability.seats.length).toBeGreaterThan(0);
  });

  it("applies weekday and weekend rules by the 06:00 Shanghai business-day boundary", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const effectiveFrom = new Date(fixedTime.getTime() + 30 * 60 * 1_000);
    const weekday = await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "schedule-business-hours",
      closesAt: "02:00",
      closesNextDay: true,
      daySet: "weekdays",
      effectiveFrom,
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      isOpen24Hours: false,
      opensAt: "10:00",
      requestId: randomUUID(),
      storeId: configuration.store.storeId,
    });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "schedule-business-hours",
      closesAt: "18:00",
      closesNextDay: false,
      daySet: "weekends",
      effectiveFrom,
      expectedVersion: weekday.version,
      idempotencyKey: randomUUID(),
      isOpen24Hours: false,
      opensAt: "10:00",
      requestId: randomUUID(),
      storeId: configuration.store.storeId,
    });
    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customerContext = {
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer" as const,
      sandboxId: context.sandboxId,
    };

    const fridayOvernight = await database.readCustomerSeatAvailability({
      ...customerContext,
      areaCode: "competitive-a",
      durationHours: 1,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-14T17:00:00.000Z"),
      storeCode: "prism-flagship",
    });
    expect(fridayOvernight.seats.length).toBeGreaterThan(0);
    await expect(
      database.readCustomerSeatAvailability({
        ...customerContext,
        areaCode: "competitive-a",
        durationHours: 1,
        machineProfileCode: "competitive",
        mode: "future",
        requestedStartsAt: new Date("2026-08-16T17:00:00.000Z"),
        storeCode: "prism-flagship",
      }),
    ).rejects.toMatchObject({ reason: "outside-business-hours" });
  });

  it("creates areas and seats from headquarters machine profiles while enforcing store-wide seat codes", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);

    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "event-zone",
      displayName: "赛事训练长名称区域",
      expectedVersion: before.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      requestId: randomUUID(),
      sortOrder: 9,
      storeId: before.store.storeId,
    });
    const afterArea = await database.readManagerStoreConfiguration(context);
    const targetArea = afterArea.areas.find(
      (area) => area.code === "competitive-a",
    )!;
    const competitive = afterArea.machineProfiles.find(
      (profile) => profile.code === "competitive",
    )!;
    const created = await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-seat",
      areaId: targetArea.areaId,
      code: "Z-99",
      expectedVersion: afterArea.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      machineProfileId: competitive.machineProfileId,
      requestId: randomUUID(),
      sortOrder: 999,
      storeId: before.store.storeId,
    });
    const confirmed = await database.readManagerStoreConfiguration(context);

    expect(created).toMatchObject({ action: "create-seat", replayed: false });
    expect(confirmed.areas).toContainEqual(
      expect.objectContaining({
        code: "event-zone",
        displayName: "赛事训练长名称区域",
        lifecycleStatus: "draft",
      }),
    );
    expect(confirmed.seats).toContainEqual(
      expect.objectContaining({
        code: "Z-99",
        lifecycleStatus: "active",
        machineProfile: expect.objectContaining({ code: "competitive" }),
      }),
    );
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-seat",
        areaId: confirmed.areas[1]!.areaId,
        code: "Z-99",
        expectedVersion: confirmed.store.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        machineProfileId: competitive.machineProfileId,
        requestId: randomUUID(),
        sortOrder: 1_000,
        storeId: before.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "duplicate-seat-code" });

    const customerRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const availability = await database.readCustomerSeatAvailability({
      areaCode: "competitive-a",
      contextVersion: customerRole.contextVersion,
      durationHours: 1,
      machineProfileCode: "competitive",
      mode: "immediate",
      personaId: customerRole.persona.id,
      role: "customer",
      sandboxId: context.sandboxId,
      storeCode: "prism-flagship",
    });
    expect(availability.seats).toContainEqual(
      expect.objectContaining({ code: "Z-99" }),
    );
  });

  it("blocks seat deactivation until active reservations and open repairs are handled", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const blocked = configuration.seats.find(
      (seat) =>
        seat.dependencies.activeReservations > 0 ||
        seat.dependencies.openRepairs > 0,
    )!;
    const requestId = randomUUID();

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-seat",
        areaId: blocked.area.areaId,
        code: blocked.code,
        expectedVersion: blocked.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "inactive",
        machineProfileId: blocked.machineProfile.machineProfileId,
        requestId,
        seatId: blocked.seatId,
        sortOrder: blocked.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "seat-dependencies" });

    const unchanged = await database.readManagerStoreConfiguration(context);
    expect(
      unchanged.seats.find((seat) => seat.seatId === blocked.seatId)
        ?.lifecycleStatus,
    ).toBe("active");
    const deniedAudit = await sql.query<{
      reason: string;
      result: string;
    }>(
      `select result, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, requestId],
    );
    expect(deniedAudit.rows).toEqual([
      { reason: "seat-dependencies", result: "denied" },
    ]);
  });

  it("replays the first denied result when its dependency later disappears", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "idempotency-zone",
      displayName: "幂等拒绝回归区",
      expectedVersion: before.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      requestId: randomUUID(),
      sortOrder: 95,
      storeId: before.store.storeId,
    });
    let configuration = await database.readManagerStoreConfiguration(context);
    const area = configuration.areas.find(
      (candidate) => candidate.code === "idempotency-zone",
    )!;
    const machineProfile = configuration.machineProfiles.find(
      (profile) => profile.code === "standard",
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-seat",
      areaId: area.areaId,
      code: "IDEM-01",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      machineProfileId: machineProfile.machineProfileId,
      requestId: randomUUID(),
      sortOrder: 1,
      storeId: before.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    const seat = configuration.seats.find(
      (candidate) => candidate.code === "IDEM-01",
    )!;
    const idempotencyKey = randomUUID();
    const firstRequestId = randomUUID();
    const replayRequestId = randomUUID();
    const archiveArea = (requestId: string) =>
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-area" as const,
        areaId: area.areaId,
        displayName: area.displayName,
        expectedVersion: area.version,
        idempotencyKey,
        lifecycleStatus: "archived" as const,
        requestId,
        sortOrder: area.sortOrder,
        storeId: before.store.storeId,
      });

    await expect(archiveArea(firstRequestId)).rejects.toMatchObject({
      reason: "area-has-active-seats",
    });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-seat",
      areaId: area.areaId,
      code: seat.code,
      expectedVersion: seat.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "inactive",
      machineProfileId: seat.machineProfile.machineProfileId,
      requestId: randomUUID(),
      seatId: seat.seatId,
      sortOrder: seat.sortOrder,
      storeId: before.store.storeId,
    });
    await expect(archiveArea(replayRequestId)).rejects.toMatchObject({
      reason: "area-has-active-seats",
    });

    const confirmed = await database.readManagerStoreConfiguration(context);
    expect(
      confirmed.areas.find((candidate) => candidate.areaId === area.areaId)
        ?.lifecycleStatus,
    ).toBe("active");
    const denials = await sql.query<{ request_id: string }>(
      `select request_id from audit_events
        where sandbox_id = $1 and request_id = any($2::uuid[])`,
      [context.sandboxId, [firstRequestId, replayRequestId]],
    );
    expect(denials.rows).toEqual([{ request_id: firstRequestId }]);
    const stored = await sql.query<{ result_data: Record<string, unknown> }>(
      `select result_data from store_config_command_requests
        where sandbox_id = $1 and actor_persona_id = $2
          and command_type = 'update-area'
          and result_data->>'reason' = 'area-has-active-seats'`,
      [context.sandboxId, context.personaId],
    );
    expect(stored.rows[0]?.result_data).toEqual({
      denied: true,
      reason: "area-has-active-seats",
    });
  });

  it("edits and deletes only unreferenced drafts while preserving referenced seat identity", async () => {
    const context = await createManagerContext();
    const before = await database.readManagerStoreConfiguration(context);
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "draft-lab",
      displayName: "草稿训练区",
      expectedVersion: before.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      requestId: randomUUID(),
      sortOrder: 12,
      storeId: before.store.storeId,
    });
    let configuration = await database.readManagerStoreConfiguration(context);
    const draftArea = configuration.areas.find(
      (area) => area.code === "draft-lab",
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-area",
      areaId: draftArea.areaId,
      displayName: "草稿训练区（已校对）",
      expectedVersion: draftArea.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      requestId: randomUUID(),
      sortOrder: 13,
      storeId: before.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    const editedArea = configuration.areas.find(
      (area) => area.areaId === draftArea.areaId,
    )!;
    const machineProfile = configuration.machineProfiles.find(
      (profile) => profile.code === "standard",
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-seat",
      areaId: editedArea.areaId,
      code: "DRAFT-01",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      machineProfileId: machineProfile.machineProfileId,
      requestId: randomUUID(),
      sortOrder: 1,
      storeId: before.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    const draftSeat = configuration.seats.find(
      (seat) => seat.code === "DRAFT-01",
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "delete-seat",
      expectedVersion: draftSeat.version,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      seatId: draftSeat.seatId,
      storeId: before.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    expect(
      configuration.seats.some((seat) => seat.seatId === draftSeat.seatId),
    ).toBe(false);
    const emptiedArea = configuration.areas.find(
      (area) => area.areaId === editedArea.areaId,
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "delete-area",
      areaId: emptiedArea.areaId,
      expectedVersion: emptiedArea.version,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      storeId: before.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    expect(
      configuration.areas.some((area) => area.areaId === draftArea.areaId),
    ).toBe(false);

    const historicallyReservedSeats = await sql.query<{ seat_id: string }>(
      `select distinct seat_id from reservations where sandbox_id = $1`,
      [context.sandboxId],
    );
    const historicallyReservedSeatIds = new Set(
      historicallyReservedSeats.rows.map((row) => row.seat_id),
    );
    const historical = configuration.seats.find(
      (seat) =>
        historicallyReservedSeatIds.has(seat.seatId) &&
        seat.businessReferenced &&
        seat.dependencies.activeReservations === 0 &&
        seat.dependencies.openRepairs === 0,
    );
    expect(historical).toBeDefined();
    const snapshotBefore = await sql.query<{ price_snapshot: unknown }>(
      `select price_snapshot from reservations
        where sandbox_id = $1 and seat_id = $2
        order by id limit 1`,
      [context.sandboxId, historical!.seatId],
    );
    expect(snapshotBefore.rows[0]).toBeDefined();
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-seat",
        areaId: historical!.area.areaId,
        code: `${historical!.code}-OLD`,
        expectedVersion: historical!.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        machineProfileId: historical!.machineProfile.machineProfileId,
        requestId: randomUUID(),
        seatId: historical!.seatId,
        sortOrder: historical!.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "referenced-seat-immutable" });
    await sql.query(
      `update machine_profiles set archived = true
        where sandbox_id = $1 and id = $2`,
      [context.sandboxId, historical!.machineProfile.machineProfileId],
    );
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-seat",
      areaId: historical!.area.areaId,
      code: historical!.code,
      expectedVersion: historical!.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "inactive",
      machineProfileId: historical!.machineProfile.machineProfileId,
      requestId: randomUUID(),
      seatId: historical!.seatId,
      sortOrder: historical!.sortOrder,
      storeId: configuration.store.storeId,
    });
    const archived = await database.readManagerStoreConfiguration(context);
    expect(
      archived.seats.find((seat) => seat.seatId === historical!.seatId),
    ).toMatchObject({ code: historical!.code, lifecycleStatus: "inactive" });
    const inactiveSeat = archived.seats.find(
      (seat) => seat.seatId === historical!.seatId,
    )!;
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-seat",
        areaId: inactiveSeat.area.areaId,
        code: inactiveSeat.code,
        expectedVersion: inactiveSeat.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        machineProfileId: inactiveSeat.machineProfile.machineProfileId,
        requestId: randomUUID(),
        seatId: inactiveSeat.seatId,
        sortOrder: inactiveSeat.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "seat-lifecycle-transition" });
    const snapshotAfter = await sql.query<{ price_snapshot: unknown }>(
      `select price_snapshot from reservations
        where sandbox_id = $1 and seat_id = $2
        order by id limit 1`,
      [context.sandboxId, historical!.seatId],
    );
    expect(snapshotAfter.rows[0]?.price_snapshot).toEqual(
      snapshotBefore.rows[0]?.price_snapshot,
    );
  });

  it("enforces one-way area and seat configuration lifecycles", async () => {
    const context = await createManagerContext();
    let configuration = await database.readManagerStoreConfiguration(context);
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "lifecycle-lab",
      displayName: "生命周期训练区",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      requestId: randomUUID(),
      sortOrder: 201,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    let area = configuration.areas.find(
      (candidate) => candidate.code === "lifecycle-lab",
    )!;
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-area",
        areaId: area.areaId,
        displayName: area.displayName,
        expectedVersion: area.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "archived",
        requestId: randomUUID(),
        sortOrder: area.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "area-lifecycle-transition" });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-area",
      areaId: area.areaId,
      displayName: area.displayName,
      expectedVersion: area.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      requestId: randomUUID(),
      sortOrder: area.sortOrder,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    area = configuration.areas.find(
      (candidate) => candidate.areaId === area.areaId,
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-area",
      areaId: area.areaId,
      displayName: area.displayName,
      expectedVersion: area.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "archived",
      requestId: randomUUID(),
      sortOrder: area.sortOrder,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    area = configuration.areas.find(
      (candidate) => candidate.areaId === area.areaId,
    )!;
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-area",
        areaId: area.areaId,
        displayName: area.displayName,
        expectedVersion: area.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        requestId: randomUUID(),
        sortOrder: area.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "area-lifecycle-transition" });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "seat-lifecycle-lab",
      displayName: "座位生命周期训练区",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      requestId: randomUUID(),
      sortOrder: 202,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    area = configuration.areas.find(
      (candidate) => candidate.code === "seat-lifecycle-lab",
    )!;
    const machineProfile = configuration.machineProfiles.find(
      (profile) => !profile.archived,
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-seat",
      areaId: area.areaId,
      code: "LC-01",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      machineProfileId: machineProfile.machineProfileId,
      requestId: randomUUID(),
      sortOrder: 201,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    let seat = configuration.seats.find(
      (candidate) => candidate.code === "LC-01",
    )!;
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-seat",
        areaId: seat.area.areaId,
        code: seat.code,
        expectedVersion: seat.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "inactive",
        machineProfileId: seat.machineProfile.machineProfileId,
        requestId: randomUUID(),
        seatId: seat.seatId,
        sortOrder: seat.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "seat-lifecycle-transition" });
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-seat",
      areaId: seat.area.areaId,
      code: seat.code,
      expectedVersion: seat.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      machineProfileId: seat.machineProfile.machineProfileId,
      requestId: randomUUID(),
      seatId: seat.seatId,
      sortOrder: seat.sortOrder,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    seat = configuration.seats.find(
      (candidate) => candidate.seatId === seat.seatId,
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "update-seat",
      areaId: seat.area.areaId,
      code: seat.code,
      expectedVersion: seat.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "inactive",
      machineProfileId: seat.machineProfile.machineProfileId,
      requestId: randomUUID(),
      seatId: seat.seatId,
      sortOrder: seat.sortOrder,
      storeId: configuration.store.storeId,
    });
    const inactive = (
      await database.readManagerStoreConfiguration(context)
    ).seats.find((candidate) => candidate.seatId === seat.seatId)!;
    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-seat",
        areaId: inactive.area.areaId,
        code: inactive.code,
        expectedVersion: inactive.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        machineProfileId: inactive.machineProfile.machineProfileId,
        requestId: randomUUID(),
        seatId: inactive.seatId,
        sortOrder: inactive.sortOrder,
        storeId: configuration.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "seat-lifecycle-transition" });
  });

  it("settles due reservation dependencies before returning configuration", async () => {
    const manager = await createManagerContext();
    const customerRole = await database.switchRoleContext({
      ...manager,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customer = {
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer" as const,
      sandboxId: manager.sandboxId,
    };
    const requestedStartsAt = new Date("2026-08-10T12:30:00.000Z");
    const availability = await database.readCustomerSeatAvailability({
      ...customer,
      areaCode: "competitive-a",
      durationHours: 1,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt,
      storeCode: "prism-flagship",
    });
    const availableSeat = availability.seats.find(
      (seat) => seat.availability === "available",
    )!;
    const pending = await database.createCustomerPendingReservation({
      ...customer,
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 1,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt,
      requestId: randomUUID(),
      seatCode: availableSeat.code,
      storeCode: "prism-flagship",
    });
    await sql.query(
      `update reservations set hold_expires_at = $3
        where sandbox_id = $1 and id = $2`,
      [
        manager.sandboxId,
        pending.reservationId,
        new Date(fixedTime.getTime() - 60_000),
      ],
    );
    const managerRole = await database.switchRoleContext({
      ...customer,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const context = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: manager.sandboxId,
    };
    const configuration = await database.readManagerStoreConfiguration(context);
    const configuredSeat = configuration.seats.find(
      (seat) => seat.code === availableSeat.code,
    )!;
    const reservation = await sql.query<{ status: string }>(
      `select status from reservations where sandbox_id = $1 and id = $2`,
      [context.sandboxId, pending.reservationId],
    );
    expect(reservation.rows[0]?.status).toBe("expired");
    const remaining = await sql.query<{ count: number }>(
      `select count(*)::integer as count from reservations
        where sandbox_id = $1 and seat_id = $2
          and status = any($3::text[])`,
      [
        context.sandboxId,
        configuredSeat.seatId,
        ["pending-confirmation", "confirmed", "arrived", "in-use"],
      ],
    );
    expect(
      configuration.seats.find((seat) => seat.seatId === configuredSeat.seatId)
        ?.dependencies.activeReservations,
    ).toBe(remaining.rows[0]?.count);
  });

  it("keeps draft seats out of staff repair intake and repair creation", async () => {
    const context = await createManagerContext();
    let configuration = await database.readManagerStoreConfiguration(context);
    const activeArea = configuration.areas.find(
      (area) => area.lifecycleStatus === "active",
    )!;
    const machineProfile = configuration.machineProfiles.find(
      (profile) => !profile.archived,
    )!;
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-seat",
      areaId: activeArea.areaId,
      code: "DRAFT-REPAIR",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "draft",
      machineProfileId: machineProfile.machineProfileId,
      requestId: randomUUID(),
      sortOrder: 901,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    const draftSeat = configuration.seats.find(
      (seat) => seat.code === "DRAFT-REPAIR",
    )!;
    const staffRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "staff",
    });
    const staff = {
      contextVersion: staffRole.contextVersion,
      personaId: staffRole.persona.id,
      role: "staff" as const,
      sandboxId: context.sandboxId,
    };
    const intake = await database.readStaffRepairIntake(staff);
    expect(intake.seats.some((seat) => seat.id === draftSeat.seatId)).toBe(
      false,
    );
    await expect(
      database.createStaffRepair({
        ...staff,
        description: "草稿座位不应进入报修业务。",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        seatId: draftSeat.seatId,
      }),
    ).rejects.toMatchObject({ reason: "seat-not-found" });
  });

  it("serializes area archival against active-seat creation", async () => {
    const context = await createManagerContext();
    let configuration = await database.readManagerStoreConfiguration(context);
    await database.executeManagerStoreConfigurationCommand({
      ...context,
      action: "create-area",
      code: "race-lab",
      displayName: "并发训练区",
      expectedVersion: configuration.store.version,
      idempotencyKey: randomUUID(),
      lifecycleStatus: "active",
      requestId: randomUUID(),
      sortOrder: 902,
      storeId: configuration.store.storeId,
    });
    configuration = await database.readManagerStoreConfiguration(context);
    const area = configuration.areas.find(
      (candidate) => candidate.code === "race-lab",
    )!;
    const profile = configuration.machineProfiles.find(
      (candidate) => !candidate.archived,
    )!;
    const results = await Promise.allSettled([
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-area",
        areaId: area.areaId,
        displayName: area.displayName,
        expectedVersion: area.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "archived",
        requestId: randomUUID(),
        sortOrder: area.sortOrder,
        storeId: configuration.store.storeId,
      }),
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "create-seat",
        areaId: area.areaId,
        code: "RACE-01",
        expectedVersion: configuration.store.version,
        idempotencyKey: randomUUID(),
        lifecycleStatus: "active",
        machineProfileId: profile.machineProfileId,
        requestId: randomUUID(),
        sortOrder: 1,
        storeId: configuration.store.storeId,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const confirmed = await database.readManagerStoreConfiguration(context);
    const confirmedArea = confirmed.areas.find(
      (candidate) => candidate.areaId === area.areaId,
    )!;
    const activeSeatExists = confirmed.seats.some(
      (seat) =>
        seat.area.areaId === area.areaId && seat.lifecycleStatus === "active",
    );
    expect(
      confirmedArea.lifecycleStatus === "archived" && activeSeatExists,
    ).toBe(false);
  });

  it("rejects cross-store writes and resolves concurrent saves with one authoritative version", async () => {
    const context = await createManagerContext();
    const configuration = await database.readManagerStoreConfiguration(context);
    const foreignStoreId = randomUUID();
    const crossStoreRequestId = randomUUID();

    await expect(
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-profile",
        displayName: "越权门店名称",
        expectedVersion: 1,
        fictitiousCity: "栖光市（虚构）",
        idempotencyKey: randomUUID(),
        introduction: "这条跨店请求不得改变任何门店。",
        requestId: crossStoreRequestId,
        storeId: foreignStoreId,
      }),
    ).rejects.toMatchObject({ reason: "cross-store" });
    const deniedCrossStore = await sql.query<{
      reason: string;
      result: string;
      store_id: string;
    }>(
      `select store_id, result, reason from audit_events
        where sandbox_id = $1 and request_id = $2`,
      [context.sandboxId, crossStoreRequestId],
    );
    expect(deniedCrossStore.rows).toEqual([
      {
        reason: "cross-store",
        result: "denied",
        store_id: configuration.store.storeId,
      },
    ]);

    const command = (displayName: string) =>
      database.executeManagerStoreConfigurationCommand({
        ...context,
        action: "update-store-profile" as const,
        displayName,
        expectedVersion: configuration.store.version,
        fictitiousCity: "栖光市（虚构）",
        idempotencyKey: randomUUID(),
        introduction: "并发保存时只允许一个已确认版本成为权威结果。",
        requestId: randomUUID(),
        storeId: configuration.store.storeId,
      });
    const results = await Promise.allSettled([
      command("并发版本甲"),
      command("并发版本乙"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { reason: "version-conflict" } });
    const confirmed = await database.readManagerStoreConfiguration(context);
    expect(["并发版本甲", "并发版本乙"]).toContain(confirmed.store.displayName);
  });
});
