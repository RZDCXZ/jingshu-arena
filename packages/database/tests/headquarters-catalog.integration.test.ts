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

const fixedTime = new Date("2026-08-11T11:30:00.000Z");
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

describe("headquarters catalogs", () => {
  it("reads the twelve fictional products, their store scope, and the three experience profiles", async () => {
    const context = await createHeadquartersContext();

    const catalogs = await database.readHeadquartersCatalogs(context);

    expect(catalogs.products).toHaveLength(12);
    expect(
      new Set(catalogs.products.map((product) => product.category)),
    ).toEqual(new Set(["drink", "meal", "snack", "supply"]));
    expect(
      catalogs.products.reduce<Record<string, number>>((counts, product) => {
        counts[product.category] = (counts[product.category] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ drink: 4, meal: 2, snack: 4, supply: 2 });
    expect(
      catalogs.products.every(
        (product) =>
          product.availableStores.length > 0 &&
          product.availableStores.every(
            (store) => store.displayName.length > 0,
          ),
      ),
    ).toBe(true);
    expect(JSON.stringify(catalogs.products)).not.toMatch(
      /酒|烟|充值|处方|可口可乐|百事|红牛/u,
    );
    expect(catalogs.machineProfiles).toMatchObject([
      {
        code: "standard",
        displayName: "标准型",
        experienceDescription: "1080p / 144Hz",
      },
      {
        code: "competitive",
        displayName: "竞技型",
        experienceDescription: "2K / 180Hz",
      },
      {
        code: "flagship",
        displayName: "旗舰型",
        experienceDescription: "2K / 240Hz",
      },
    ]);
  });

  it("rejects restricted catalog content in Chinese and English", async () => {
    const context = await createHeadquartersContext();
    const catalogs = await database.readHeadquartersCatalogs(context);
    const storeIds = catalogs.stores.map((store) => store.storeId);

    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "create-product",
        availableStoreIds: storeIds,
        category: "drink",
        code: "restricted-beverage",
        description: "cold beer for adults",
        displayName: "夜间饮品",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "HEADQUARTERS_CATALOG_CONFLICT",
      reason: "invalid-product",
    });
    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "create-product",
        availableStoreIds: storeIds,
        category: "supply",
        code: "restricted-branded-supply",
        description: "桌面清洁用品",
        displayName: "罗技清洁套装",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "HEADQUARTERS_CATALOG_CONFLICT",
      reason: "invalid-product",
    });
    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "create-machine-profile",
        code: "restricted-hardware",
        displayName: "高刷型",
        experienceDescription: "Qualcomm Snapdragon ARM Logitech 具体硬件配置",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "HEADQUARTERS_CATALOG_CONFLICT",
      reason: "invalid-machine-profile",
    });
    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "create-machine-profile",
        code: "restricted-chinese-hardware",
        displayName: "酷睿旗舰型",
        experienceDescription: "锐龙竞技型与小米外设",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "HEADQUARTERS_CATALOG_CONFLICT",
      reason: "invalid-machine-profile",
    });
  });

  it("creates, edits, and archives product records without exposing store operations", async () => {
    const context = await createHeadquartersContext();
    const before = await database.readHeadquartersCatalogs(context);
    const idempotencyKey = randomUUID();
    const create = () =>
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "create-product" as const,
        availableStoreIds: before.stores
          .slice(0, 2)
          .map((store) => store.storeId),
        category: "drink" as const,
        code: "nova-fruit-water",
        description: "无糖果味饮品 · 冷藏取用",
        displayName: "星澜果味水",
        idempotencyKey,
        requestId: randomUUID(),
      });

    const created = await create();
    await expect(create()).resolves.toMatchObject({ replayed: true });
    expect(created).toMatchObject({
      action: "create-product",
      replayed: false,
      version: 1,
    });
    const afterCreate = await database.readHeadquartersCatalogs(context);
    expect(afterCreate.products).toContainEqual(
      expect.objectContaining({
        archived: false,
        availableStores: expect.arrayContaining([
          expect.objectContaining({ storeId: before.stores[0]!.storeId }),
          expect.objectContaining({ storeId: before.stores[1]!.storeId }),
        ]),
        category: "drink",
        code: "nova-fruit-water",
        displayName: "星澜果味水",
        productId: created.objectId,
      }),
    );
    const createdProduct = afterCreate.products.find(
      (product) => product.productId === created.objectId,
    )!;
    expect(createdProduct.storeConfigurationCount).toBe(2);

    const updated = await database.executeHeadquartersCatalogCommand({
      ...context,
      action: "update-product",
      availableStoreIds: before.stores.map((store) => store.storeId),
      category: "drink",
      description: "低糖果味饮品 · 常温或冷藏取用",
      displayName: "星澜果味水二号",
      expectedVersion: createdProduct.version,
      idempotencyKey: randomUUID(),
      productId: created.objectId,
      requestId: randomUUID(),
    });
    expect(updated).toMatchObject({ action: "update-product", version: 2 });
    const afterUpdate = await database.readHeadquartersCatalogs(context);
    const updatedProduct = afterUpdate.products.find(
      (product) => product.productId === created.objectId,
    )!;
    expect(updatedProduct).toMatchObject({
      availableStores: expect.arrayContaining(
        before.stores.map((store) =>
          expect.objectContaining({ storeId: store.storeId }),
        ),
      ),
      displayName: "星澜果味水二号",
      storeConfigurationCount: 3,
      version: 2,
    });

    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "archive-product",
        expectedVersion: updatedProduct.version,
        idempotencyKey: randomUUID(),
        productId: created.objectId,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ action: "archive-product", version: 3 });
    const afterArchive = await database.readHeadquartersCatalogs(context);
    expect(
      afterArchive.products.find(
        (product) => product.productId === created.objectId,
      ),
    ).toMatchObject({ archived: true, version: 3 });
  });

  it("keeps historical order snapshots and existing audit facts unchanged when a product is renamed", async () => {
    const context = await createHeadquartersContext();
    const order = await sql.query<{
      order_snapshot: {
        lines: ReadonlyArray<{ productId: string; productName: string }>;
      };
    }>(
      `select order_snapshot from customer_orders
        where sandbox_id = $1 order by id limit 1`,
      [context.sandboxId],
    );
    const snapshotBefore = order.rows[0]!.order_snapshot;
    const productId = snapshotBefore.lines[0]!.productId;
    const catalogBefore = await database.readHeadquartersCatalogs(context);
    const product = catalogBefore.products.find(
      (candidate) => candidate.productId === productId,
    )!;
    const auditBefore = await sql.query<{
      action: string;
      after_data: unknown;
      before_data: unknown;
      id: string;
    }>(
      `select id, action, before_data, after_data from audit_events
        where sandbox_id = $1 order by id`,
      [context.sandboxId],
    );

    await database.executeHeadquartersCatalogCommand({
      ...context,
      action: "update-product",
      availableStoreIds: product.availableStores.map((store) => store.storeId),
      category: product.category,
      description: `${product.description} · 新资料名仅用于未来目录`,
      displayName: `${product.displayName}·新资料名`,
      expectedVersion: product.version,
      idempotencyKey: randomUUID(),
      productId,
      requestId: randomUUID(),
    });

    const orderAfter = await sql.query<{ order_snapshot: unknown }>(
      `select order_snapshot from customer_orders
        where sandbox_id = $1 order by id limit 1`,
      [context.sandboxId],
    );
    expect(orderAfter.rows[0]!.order_snapshot).toEqual(snapshotBefore);
    const auditAfter = await sql.query<{
      action: string;
      after_data: unknown;
      before_data: unknown;
      id: string;
    }>(
      `select id, action, before_data, after_data from audit_events
        where sandbox_id = $1 and id = any($2::uuid[]) order by id`,
      [context.sandboxId, auditBefore.rows.map((event) => event.id)],
    );
    expect(auditAfter.rows).toEqual(auditBefore.rows);
  });

  it("keeps removed store records for history while blocking configuration and new sales", async () => {
    const headquarters = await createHeadquartersContext();
    const catalogs = await database.readHeadquartersCatalogs(headquarters);
    const removedStore = catalogs.stores.find(
      (store) => store.code === "prism-flagship",
    )!;
    const listed = await sql.query<{ product_id: string }>(
      `select product_id from store_products
        where sandbox_id = $1 and store_id = $2 and listed = true
        order by product_id limit 1`,
      [headquarters.sandboxId, removedStore.storeId],
    );
    const product = catalogs.products.find(
      (candidate) => candidate.productId === listed.rows[0]!.product_id,
    )!;

    await database.executeHeadquartersCatalogCommand({
      ...headquarters,
      action: "update-product",
      availableStoreIds: catalogs.stores
        .filter((store) => store.storeId !== removedStore.storeId)
        .map((store) => store.storeId),
      category: product.category,
      description: product.description,
      displayName: product.displayName,
      expectedVersion: product.version,
      idempotencyKey: randomUUID(),
      productId: product.productId,
      requestId: randomUUID(),
    });
    const retained = await sql.query<{ listed: boolean }>(
      `select listed from store_products
        where sandbox_id = $1 and store_id = $2 and product_id = $3`,
      [headquarters.sandboxId, removedStore.storeId, product.productId],
    );
    expect(retained.rows[0]).toEqual({ listed: true });

    const managerRole = await database.switchRoleContext({
      ...headquarters,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const manager = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: managerRole.sandboxId,
    };
    const managerConfiguration =
      await database.readManagerStoreConfiguration(manager);
    expect(
      managerConfiguration.products.some(
        (candidate) => candidate.productId === product.productId,
      ),
    ).toBe(false);

    const customerRole = await database.switchRoleContext({
      ...manager,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customer = {
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer" as const,
      sandboxId: customerRole.sandboxId,
    };
    const reservation = await sql.query<{ id: string }>(
      `update reservations set status = 'arrived', arrived_business_at = $4
        where id = (
          select id from reservations
           where sandbox_id = $1 and store_id = $2
             and customer_persona_id = $3
           order by id limit 1
        ) returning id`,
      [customer.sandboxId, removedStore.storeId, customer.personaId, fixedTime],
    );
    const reservationId = reservation.rows[0]!.id;
    const customerCatalog = await database.readCustomerOrderCatalog({
      ...customer,
      reservationId,
    });
    expect(
      customerCatalog.products.some(
        (candidate) => candidate.id === product.productId,
      ),
    ).toBe(false);
    await expect(
      database.createCustomerPendingOrder({
        ...customer,
        couponId: null,
        idempotencyKey: randomUUID(),
        lines: [{ productId: product.productId, quantity: 1 }],
        requestId: randomUUID(),
        reservationId,
      }),
    ).rejects.toMatchObject({ reason: "product-not-listed" });
  });

  it("creates, edits, and archives machine profiles without real CPU or GPU brands", async () => {
    const context = await createHeadquartersContext();
    const created = await database.executeHeadquartersCatalogCommand({
      ...context,
      action: "create-machine-profile",
      code: "panorama",
      displayName: "全景型",
      experienceDescription: "2K / 200Hz · 平衡清晰度与高刷新体验",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    expect(created).toMatchObject({
      action: "create-machine-profile",
      replayed: false,
      version: 1,
    });
    const afterCreate = await database.readHeadquartersCatalogs(context);
    const profile = afterCreate.machineProfiles.find(
      (candidate) => candidate.machineProfileId === created.objectId,
    )!;
    expect(profile).toMatchObject({
      archived: false,
      code: "panorama",
      displayName: "全景型",
      seatReferenceCount: 0,
    });

    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "update-machine-profile",
        displayName: "全景型二号",
        expectedVersion: profile.version,
        experienceDescription: "2K / 200Hz · 清晰流畅的沉浸体验",
        idempotencyKey: randomUUID(),
        machineProfileId: profile.machineProfileId,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ action: "update-machine-profile", version: 2 });
    await expect(
      database.executeHeadquartersCatalogCommand({
        ...context,
        action: "archive-machine-profile",
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
        machineProfileId: profile.machineProfileId,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ action: "archive-machine-profile", version: 3 });
  });

  it("archives a referenced machine profile while preserving reservation and repair machine snapshots", async () => {
    const context = await createHeadquartersContext();
    const repair = await sql.query<{
      machine_profile_id: string;
      machine_profile_snapshot: unknown;
    }>(
      `select machine_profile_id, machine_profile_snapshot from repairs
        where sandbox_id = $1 order by id limit 1`,
      [context.sandboxId],
    );
    const machineProfileId = repair.rows[0]!.machine_profile_id;
    const repairSnapshotBefore = repair.rows[0]!.machine_profile_snapshot;
    const reservation = await sql.query<{ price_snapshot: unknown }>(
      `select reservation.price_snapshot
         from reservations reservation
         join seats seat on seat.id = reservation.seat_id
        where reservation.sandbox_id = $1
          and seat.machine_profile_id = $2
          and reservation.price_snapshot is not null
        order by reservation.id limit 1`,
      [context.sandboxId, machineProfileId],
    );
    const reservationSnapshotBefore = reservation.rows[0]!.price_snapshot;
    const catalog = await database.readHeadquartersCatalogs(context);
    const profile = catalog.machineProfiles.find(
      (candidate) => candidate.machineProfileId === machineProfileId,
    )!;
    expect(profile.seatReferenceCount).toBeGreaterThan(0);
    expect(profile.historicalReferenceCount).toBeGreaterThan(0);

    const renamed = await database.executeHeadquartersCatalogCommand({
      ...context,
      action: "update-machine-profile",
      displayName: `${profile.displayName}·新资料名`,
      expectedVersion: profile.version,
      experienceDescription: `${profile.experienceDescription} · 仅未来展示`,
      idempotencyKey: randomUUID(),
      machineProfileId,
      requestId: randomUUID(),
    });
    await database.executeHeadquartersCatalogCommand({
      ...context,
      action: "archive-machine-profile",
      expectedVersion: renamed.version,
      idempotencyKey: randomUUID(),
      machineProfileId,
      requestId: randomUUID(),
    });

    const repairAfter = await sql.query<{ machine_profile_snapshot: unknown }>(
      `select machine_profile_snapshot from repairs
        where sandbox_id = $1 and machine_profile_id = $2 order by id limit 1`,
      [context.sandboxId, machineProfileId],
    );
    const reservationAfter = await sql.query<{ price_snapshot: unknown }>(
      `select reservation.price_snapshot
         from reservations reservation
         join seats seat on seat.id = reservation.seat_id
        where reservation.sandbox_id = $1
          and seat.machine_profile_id = $2
          and reservation.price_snapshot is not null
        order by reservation.id limit 1`,
      [context.sandboxId, machineProfileId],
    );
    expect(repairAfter.rows[0]!.machine_profile_snapshot).toEqual(
      repairSnapshotBefore,
    );
    expect(reservationAfter.rows[0]!.price_snapshot).toEqual(
      reservationSnapshotBefore,
    );
    await expect(
      sql.query(`delete from machine_profiles where id = $1`, [
        machineProfileId,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
