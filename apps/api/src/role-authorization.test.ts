import { describe, expect, it } from "vitest";

import {
  authorizeRoleCapability,
  listRoleCapabilities,
  type RoleAuthorizationContext,
  type RoleCapability,
} from "./role-authorization.js";

const flagshipStoreId = "00000000-0000-4000-8000-000000000101";
const standardStoreId = "00000000-0000-4000-8000-000000000102";
const newStoreId = "00000000-0000-4000-8000-000000000103";
const sandboxId = "00000000-0000-4000-8000-000000000301";
const otherSandboxId = "00000000-0000-4000-8000-000000000302";

const contexts = {
  customer: {
    personaId: "00000000-0000-4000-8000-000000000201",
    role: "customer",
    sandboxId,
    storeIds: [],
  },
  staff: {
    personaId: "00000000-0000-4000-8000-000000000202",
    role: "staff",
    sandboxId,
    storeIds: [flagshipStoreId],
  },
  manager: {
    personaId: "00000000-0000-4000-8000-000000000203",
    role: "manager",
    sandboxId,
    storeIds: [flagshipStoreId],
  },
  hq: {
    personaId: "00000000-0000-4000-8000-000000000204",
    role: "hq",
    sandboxId,
    storeIds: [flagshipStoreId, standardStoreId, newStoreId],
  },
} as const satisfies Record<string, RoleAuthorizationContext>;

function can(
  context: RoleAuthorizationContext,
  capability: RoleCapability,
  target: {
    ownerPersonaId?: string;
    sandboxId?: string;
    storeId?: string;
  } = {},
): boolean {
  return authorizeRoleCapability(context, {
    capability,
    sandboxId,
    ...target,
  });
}

describe("role capability authorization", () => {
  it("lets a customer manage only records owned by the current demo persona", () => {
    expect(
      can(contexts.customer, "customer:manage-own-records", {
        ownerPersonaId: contexts.customer.personaId,
      }),
    ).toBe(true);
    expect(
      can(contexts.customer, "customer:manage-own-records", {
        ownerPersonaId: "00000000-0000-4000-8000-000000000299",
      }),
    ).toBe(false);
    expect(
      can(contexts.customer, "store:perform-frontline", {
        storeId: flagshipStoreId,
      }),
    ).toBe(false);
  });

  it("limits staff to frontline work in their assigned store", () => {
    expect(
      can(contexts.staff, "store:perform-frontline", {
        storeId: flagshipStoreId,
      }),
    ).toBe(true);
    expect(
      can(contexts.staff, "store:perform-frontline", {
        storeId: standardStoreId,
      }),
    ).toBe(false);
    expect(
      can(contexts.staff, "store:adjust-inventory", {
        storeId: flagshipStoreId,
      }),
    ).toBe(false);
    expect(
      can(contexts.staff, "store:configure", {
        storeId: flagshipStoreId,
      }),
    ).toBe(false);
  });

  it("limits managers to authorized operations and management in their assigned store", () => {
    for (const capability of [
      "store:perform-frontline",
      "store:adjust-inventory",
      "store:configure",
      "store:manage-people",
      "audit:view",
    ] as const) {
      expect(
        can(contexts.manager, capability, { storeId: flagshipStoreId }),
      ).toBe(true);
      expect(
        can(contexts.manager, capability, { storeId: standardStoreId }),
      ).toBe(false);
    }
    expect(can(contexts.manager, "chain:compare")).toBe(false);
  });

  it("lets headquarters cover all three stores without inheriting frontline actions", () => {
    for (const storeId of contexts.hq.storeIds) {
      expect(can(contexts.hq, "store:configure", { storeId })).toBe(true);
      expect(can(contexts.hq, "audit:view", { storeId })).toBe(true);
      expect(can(contexts.hq, "store:perform-frontline", { storeId })).toBe(
        false,
      );
      expect(can(contexts.hq, "store:adjust-inventory", { storeId })).toBe(
        false,
      );
      expect(can(contexts.hq, "store:manage-people", { storeId })).toBe(false);
    }
    expect(can(contexts.hq, "chain:compare")).toBe(true);
    expect(can(contexts.hq, "chain:configure")).toBe(true);
    expect(
      can(contexts.hq, "chain:compare", { sandboxId: otherSandboxId }),
    ).toBe(false);
  });

  it("rejects every capability when the target belongs to another sandbox", () => {
    expect(
      can(contexts.customer, "customer:manage-own-records", {
        ownerPersonaId: contexts.customer.personaId,
        sandboxId: otherSandboxId,
      }),
    ).toBe(false);
    expect(
      can(contexts.staff, "store:perform-frontline", {
        sandboxId: otherSandboxId,
        storeId: flagshipStoreId,
      }),
    ).toBe(false);
  });

  it("lists only the capability families granted to each role", () => {
    expect(listRoleCapabilities(contexts.customer)).toEqual([
      "customer:manage-own-records",
    ]);
    expect(listRoleCapabilities(contexts.staff)).toEqual([
      "store:perform-frontline",
    ]);
    expect(listRoleCapabilities(contexts.manager)).toEqual([
      "store:perform-frontline",
      "store:adjust-inventory",
      "store:configure",
      "store:manage-people",
      "audit:view",
    ]);
    expect(listRoleCapabilities(contexts.hq)).toEqual([
      "store:configure",
      "chain:compare",
      "chain:configure",
      "audit:view",
    ]);
  });
});
