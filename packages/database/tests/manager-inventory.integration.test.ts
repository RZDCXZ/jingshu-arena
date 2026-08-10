import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createPublicSandboxDatabase,
  type ExecuteManagerInventoryCommandInput,
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
const { Client } = pg;

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

async function createFrontlineContext(role: "manager" | "staff") {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: role,
    visitorKey: `visitor-${randomUUID()}`,
  });
  return {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role,
    sandboxId: world.sandboxId,
  } as const;
}

async function withSandboxSql<T>(
  sandboxId: string,
  run: (client: pg.Client) => Promise<T>,
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      sandboxId,
    ]);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

type ManagerContext = Awaited<ReturnType<typeof createFrontlineContext>>;

async function inventoryPersistenceSnapshot(context: ManagerContext) {
  const inventory = await database.readStoreInventory(context);
  const counts = await withSandboxSql(context.sandboxId, async (client) =>
    client.query<{
      commands: number;
      denied_audits: number;
      movements: number;
    }>(
      `select
          (select count(*)::integer from inventory_movements where sandbox_id = $1) as movements,
          (select count(*)::integer from inventory_command_requests where sandbox_id = $1) as commands,
          (select count(*)::integer from audit_events
            where sandbox_id = $1 and action like 'inventory.%' and result = 'denied') as denied_audits`,
      [context.sandboxId],
    ),
  );
  return {
    commands: counts.rows[0]!.commands,
    deniedAudits: counts.rows[0]!.denied_audits,
    items: inventory.items,
    movements: counts.rows[0]!.movements,
  };
}

async function expectRejectedWithoutInventoryMutation(
  context: ManagerContext,
  command: ExecuteManagerInventoryCommandInput,
  reason: string,
) {
  const before = await inventoryPersistenceSnapshot(context);
  await expect(
    database.executeManagerInventoryCommand(command),
  ).rejects.toMatchObject({ reason });
  const after = await inventoryPersistenceSnapshot(context);
  expect(after).toEqual({
    ...before,
    deniedAudits: before.deniedAudits + 1,
  });
  const denial = await withSandboxSql(context.sandboxId, async (client) =>
    client.query<{ reason: string; result: string }>(
      `select reason, result from audit_events
          where sandbox_id = $1 and action like 'inventory.%'
            and request_id = $2 and reason = $3 and result = 'denied'`,
      [context.sandboxId, command.requestId, reason],
    ),
  );
  expect(denial.rows).toContainEqual({ reason, result: "denied" });
}

describe("manager inventory ledger", () => {
  it("shows staff the store-scoped product and eight-spare balances with the inventory identity", async () => {
    const context = await createFrontlineContext("staff");

    const inventory = await database.readStoreInventory(context);

    expect(inventory.store).toEqual({
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
    });
    expect(inventory.summary).toEqual({
      alertCount: 3,
      itemCount: 20,
      productCount: 12,
      spareCount: 8,
    });
    expect(inventory.items).toHaveLength(20);
    expect(
      inventory.items.filter((item) => item.kind === "spare"),
    ).toHaveLength(8);
    expect(
      inventory.items.every(
        (item) =>
          Number.isInteger(item.onHandQuantity) &&
          Number.isInteger(item.reservedQuantity) &&
          Number.isInteger(item.availableQuantity) &&
          item.availableQuantity ===
            item.onHandQuantity - item.reservedQuantity &&
          item.availableQuantity >= 0 &&
          item.alerting === item.availableQuantity <= item.lowStockThreshold,
      ),
    ).toBe(true);
  });

  it("receives a positive integer into an alerting item and safely replays the movement", async () => {
    const context = await createFrontlineContext("manager");
    const before = await database.readStoreInventory(context);
    const item = before.items.find((candidate) => candidate.alerting);
    expect(item).toBeDefined();
    const quantity = item!.lowStockThreshold + 1 - item!.availableQuantity;
    const idempotencyKey = randomUUID();
    const command = {
      ...context,
      action: "receipt" as const,
      idempotencyKey,
      inventoryItemId: item!.inventoryItemId,
      quantity,
      reason: "门店补货到货，店长已复核数量。",
      requestId: randomUUID(),
    };

    const received = await database.executeManagerInventoryCommand(command);
    const replay = await database.executeManagerInventoryCommand({
      ...command,
      requestId: randomUUID(),
    });
    const after = await database.readStoreInventory(context);
    const updated = after.items.find(
      (candidate) => candidate.inventoryItemId === item!.inventoryItemId,
    );

    expect(received).toMatchObject({
      action: "receipt",
      alertTransition: "resolved",
      onHandAfter: item!.onHandQuantity + quantity,
      onHandDelta: quantity,
      replayed: false,
    });
    expect(replay).toEqual({ ...received, replayed: true });
    expect(updated).toMatchObject({
      alerting: false,
      availableQuantity: item!.lowStockThreshold + 1,
      onHandQuantity: item!.onHandQuantity + quantity,
    });
  });

  it("stocktakes by delta and compensates with a new linked movement without rewriting history", async () => {
    const context = await createFrontlineContext("manager");
    const before = await database.readStoreInventory(context);
    const item = before.items.find(
      (candidate) => candidate.onHandQuantity >= 3,
    );
    expect(item).toBeDefined();

    const stocktake = await database.executeManagerInventoryCommand({
      ...context,
      action: "stocktake",
      actualQuantity: item!.onHandQuantity - 2,
      idempotencyKey: randomUUID(),
      inventoryItemId: item!.inventoryItemId,
      reason: "闭店前盘点，现场实际数量已由店长复核。",
      requestId: randomUUID(),
    });
    const compensation = await database.executeManagerInventoryCommand({
      ...context,
      action: "compensation",
      idempotencyKey: randomUUID(),
      inventoryItemId: item!.inventoryItemId,
      onHandDelta: 2,
      originalMovementId: stocktake.movementId,
      reason: "原盘点漏计两件，关联原盘点流水进行补偿。",
      requestId: randomUUID(),
    });
    const after = await database.readStoreInventory(context);
    const original = after.movements.find(
      (movement) => movement.movementId === stocktake.movementId,
    );
    const correction = after.movements.find(
      (movement) => movement.movementId === compensation.movementId,
    );

    expect(stocktake).toMatchObject({
      action: "stocktake",
      onHandAfter: item!.onHandQuantity - 2,
      onHandDelta: -2,
    });
    expect(original).toMatchObject({
      kind: "stocktake",
      onHandAfter: item!.onHandQuantity - 2,
      onHandDelta: -2,
      originalMovementId: null,
    });
    expect(correction).toMatchObject({
      kind: "compensation",
      onHandAfter: item!.onHandQuantity,
      onHandDelta: 2,
      originalMovementId: stocktake.movementId,
    });
  });

  it("keeps each item's latest movement even when another item fills the global ledger window", async () => {
    const context = await createFrontlineContext("manager");
    const inventory = await database.readStoreInventory(context);
    const busyItem = inventory.items[0]!;
    const quietItem = inventory.items[1]!;
    const quietMovementId = randomUUID();
    await withSandboxSql(context.sandboxId, async (client) => {
      await client.query(
        `insert into inventory_movements (
           id, sandbox_id, store_id, inventory_item_id, order_id,
           movement_kind, compensates_movement_id, reason, on_hand_delta,
           on_hand_after, business_occurred_at, recorded_at
         ) values (
           $1, $2,
           (select store_id from inventory_items where id = $3),
           $3, null, 'receipt', null, '较早的独立项目流水', 1, 1,
           '2026-08-10T09:00:00.000Z', '2026-08-10T09:00:00.000Z'
         )`,
        [quietMovementId, context.sandboxId, quietItem.inventoryItemId],
      );
      for (let index = 0; index < 21; index += 1) {
        const occurredAt = new Date(
          Date.parse("2026-08-10T10:00:00.000Z") + index * 1_000,
        );
        await client.query(
          `insert into inventory_movements (
             id, sandbox_id, store_id, inventory_item_id, order_id,
             movement_kind, compensates_movement_id, reason, on_hand_delta,
             on_hand_after, business_occurred_at, recorded_at
           ) values (
             $1, $2,
             (select store_id from inventory_items where id = $3),
             $3, null, 'receipt', null, '高频项目流水', 1, 1, $4, $4
           )`,
          [
            randomUUID(),
            context.sandboxId,
            busyItem.inventoryItemId,
            occurredAt,
          ],
        );
      }
    });

    const after = await database.readStoreInventory(context);
    expect(after.movements).toHaveLength(20);
    expect(
      after.movements.some(
        (movement) => movement.inventoryItemId === quietItem.inventoryItemId,
      ),
    ).toBe(false);
    expect(
      after.items.find(
        (item) => item.inventoryItemId === quietItem.inventoryItemId,
      )?.recentMovement,
    ).toMatchObject({
      inventoryItemId: quietItem.inventoryItemId,
      movementId: quietMovementId,
      reason: "较早的独立项目流水",
    });
  });

  it("rolls back every rejected inventory command while recording its denial", async () => {
    const context = await createFrontlineContext("manager");
    const inventory = await database.readStoreInventory(context);
    const item = inventory.items[0]!;
    const base = {
      ...context,
      inventoryItemId: item.inventoryItemId,
      requestId: randomUUID(),
    };

    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "receipt",
        idempotencyKey: randomUUID(),
        quantity: 1,
        reason: "<script>",
      },
      "invalid-reason",
    );
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "receipt",
        idempotencyKey: randomUUID(),
        quantity: 0,
        reason: "数量无效但原因文本本身有效。",
      },
      "invalid-quantity",
    );
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "stocktake",
        actualQuantity: item.onHandQuantity,
        idempotencyKey: randomUUID(),
        reason: "实际数量与账面完全相同。",
      },
      "no-change",
    );
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "compensation",
        idempotencyKey: randomUUID(),
        onHandDelta: -(item.onHandQuantity + 1),
        originalMovementId: null,
        reason: "尝试修正错误操作，但本次差额会导致负数。",
      },
      "reserved-inventory",
    );
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "compensation",
        idempotencyKey: randomUUID(),
        onHandDelta: 1,
        originalMovementId: randomUUID(),
        reason: "关联了一条并不存在的原流水。",
      },
      "original-movement-not-found",
    );
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "receipt",
        idempotencyKey: randomUUID(),
        inventoryItemId: randomUUID(),
        quantity: 1,
        reason: "提交了一条不存在的库存项目。",
      },
      "not-found",
    );

    const idempotencyKey = randomUUID();
    await database.executeManagerInventoryCommand({
      ...base,
      action: "receipt",
      idempotencyKey,
      quantity: 1,
      reason: "先完成一条可安全重放的入库。",
    });
    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...base,
        action: "receipt",
        idempotencyKey,
        quantity: 2,
        reason: "先完成一条可安全重放的入库。",
      },
      "idempotency-conflict",
    );
  });

  it("rejects a manager's attempt to adjust another store", async () => {
    const context = await createFrontlineContext("manager");
    const foreignItem = await withSandboxSql(
      context.sandboxId,
      async (client) =>
        client.query<{ id: string }>(
          `select item.id from inventory_items item
          join stores store on store.id = item.store_id
         where item.sandbox_id = $1 and store.code <> 'prism-flagship'
         order by item.id limit 1`,
          [context.sandboxId],
        ),
    );

    await expectRejectedWithoutInventoryMutation(
      context,
      {
        ...context,
        action: "receipt",
        idempotencyKey: randomUUID(),
        inventoryItemId: foreignItem.rows[0]!.id,
        quantity: 1,
        reason: "错误的跨店补货请求。",
        requestId: randomUUID(),
      },
      "cross-store",
    );
  });
});
