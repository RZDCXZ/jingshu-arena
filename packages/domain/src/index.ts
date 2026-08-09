export const PUBLIC_SANDBOX_SCHEMA_VERSION = "4";
export const PUBLIC_SANDBOX_SEED_VERSION = "2026-08-09.1";
export const SANDBOX_BUSINESS_TIME_ZONE = "Asia/Shanghai";
export const SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS = 24 * 60 * 60 * 1_000;

export type SandboxBusinessTimeAdvanceMode = "next-event" | "half-hour";

interface SandboxBusinessTimeInput {
  readonly advancedMilliseconds: number;
  readonly businessAnchor: Date;
  readonly wallAnchor: Date;
  readonly wallTime: Date;
}

interface SandboxBusinessTimeAdvanceInput {
  readonly accumulatedAdvanceMilliseconds: number;
  readonly currentBusinessTime: Date;
  readonly mode: SandboxBusinessTimeAdvanceMode;
  readonly nextEventTime: Date | null;
}

export function sandboxBusinessTimeAt({
  advancedMilliseconds,
  businessAnchor,
  wallAnchor,
  wallTime,
}: SandboxBusinessTimeInput): Date {
  return new Date(
    businessAnchor.getTime() +
      (wallTime.getTime() - wallAnchor.getTime()) +
      advancedMilliseconds,
  );
}

export function planSandboxBusinessTimeAdvance(
  input: SandboxBusinessTimeAdvanceInput,
):
  | {
      readonly status: "ready";
      readonly accumulatedAdvanceMilliseconds: number;
      readonly advanceByMilliseconds: number;
      readonly afterBusinessTime: Date;
    }
  | { readonly status: "limit-reached"; readonly limitMilliseconds: number }
  | { readonly status: "no-next-event" } {
  const advanceByMilliseconds =
    input.mode === "half-hour"
      ? 30 * 60 * 1_000
      : (input.nextEventTime?.getTime() ?? 0) -
        input.currentBusinessTime.getTime();

  if (input.mode === "next-event" && advanceByMilliseconds <= 0) {
    return { status: "no-next-event" };
  }

  const accumulatedAdvanceMilliseconds =
    input.accumulatedAdvanceMilliseconds + advanceByMilliseconds;
  if (accumulatedAdvanceMilliseconds > SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS) {
    return {
      limitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
      status: "limit-reached",
    };
  }

  return {
    accumulatedAdvanceMilliseconds,
    advanceByMilliseconds,
    afterBusinessTime: new Date(
      input.currentBusinessTime.getTime() + advanceByMilliseconds,
    ),
    status: "ready",
  };
}

type PublicSandboxRole = "customer" | "staff" | "manager" | "hq";

interface PublicSandboxStoreSeed {
  readonly code: string;
  readonly displayName: string;
  readonly seatCount: number;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly closesNextDay: boolean;
  readonly isOpen24Hours: boolean;
}

interface PublicSandboxPersonaSeed {
  readonly role: PublicSandboxRole;
  readonly displayName: string;
  readonly scope: string;
  readonly protected: true;
  readonly storeCode?: PublicSandboxStoreSeed["code"];
}

export interface PublicSandboxSeed {
  readonly schemaVersion: string;
  readonly seedVersion: string;
  readonly operator: {
    readonly displayName: string;
    readonly city: string;
  };
  readonly stores: ReadonlyArray<PublicSandboxStoreSeed>;
  readonly personas: ReadonlyArray<PublicSandboxPersonaSeed>;
}

const storeSeeds = [
  {
    code: "prism-flagship",
    displayName: "棱镜旗舰店",
    seatCount: 96,
    opensAt: "00:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: true,
  },
  {
    code: "starbridge-standard",
    displayName: "星桥标准店",
    seatCount: 64,
    opensAt: "10:00",
    closesAt: "02:00",
    closesNextDay: true,
    isOpen24Hours: false,
  },
  {
    code: "apex-new",
    displayName: "极点新店",
    seatCount: 40,
    opensAt: "12:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: false,
  },
] as const satisfies ReadonlyArray<PublicSandboxStoreSeed>;

const personaSeeds = [
  {
    role: "customer",
    displayName: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
    protected: true,
  },
  {
    role: "staff",
    displayName: "周宁",
    scope: "棱镜旗舰店",
    protected: true,
    storeCode: "prism-flagship",
  },
  {
    role: "manager",
    displayName: "许知远",
    scope: "棱镜旗舰店",
    protected: true,
    storeCode: "prism-flagship",
  },
  {
    role: "hq",
    displayName: "沈微",
    scope: "固定三店",
    protected: true,
  },
] as const satisfies ReadonlyArray<PublicSandboxPersonaSeed>;

export function buildPublicSandboxSeed(): PublicSandboxSeed {
  return {
    schemaVersion: PUBLIC_SANDBOX_SCHEMA_VERSION,
    seedVersion: PUBLIC_SANDBOX_SEED_VERSION,
    operator: {
      displayName: "竞枢演示经营方",
      city: "栖光市",
    },
    stores: storeSeeds.map((store) => ({ ...store })),
    personas: personaSeeds.map((persona) => ({ ...persona })),
  };
}
