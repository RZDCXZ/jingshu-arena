export const PUBLIC_SANDBOX_SCHEMA_VERSION = "3";
export const PUBLIC_SANDBOX_SEED_VERSION = "2026-08-09.1";

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
