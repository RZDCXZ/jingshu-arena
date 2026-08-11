import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import type {
  CustomerReservationStatus,
  HandoverCommandResponse,
  HeadquartersPeopleScheduleResponse,
  ManagerHandoverExceptionsResponse,
  ManagerDashboardResponse,
  ManagerDashboardDrilldownKind,
  ManagerPeopleCommandRequest,
  ManagerPeopleScheduleResponse,
  ManagerShiftCoveragePreviewRequest,
  ManagerShiftCoveragePreviewResponse,
  ManagerStoreConfigurationCommandRequest,
  ManagerStoreConfigurationResponse,
  PublicRole,
  PublicSandboxReadyResponse,
  RepairDetailResponse,
  RoleContextReadyResponse,
  StoreInventoryResponse,
  StaffOrderDetailResponse,
  StaffOrderSummaryResponse,
  StaffReservationDetailResponse,
  StaffReservationSummary,
  StaffShiftAttendanceResponse,
  StaffHandover,
  StaffHandoverSnapshot,
  StaffHandoversResponse,
} from "@jingshu/contracts";

type MutableStaffReservationSummary = Omit<
  StaffReservationSummary,
  "status"
> & {
  status: CustomerReservationStatus;
};

type MutableStaffOrderSummary = Omit<StaffOrderSummaryResponse, "status"> & {
  status: StaffOrderSummaryResponse["status"];
};

const roleDetails = {
  customer: {
    capabilities: ["customer:manage-own-records"],
    label: "顾客",
    persona: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
    scopeKind: "customer",
    stores: [
      { code: "prism-flagship", displayName: "棱镜旗舰店" },
      { code: "starbridge-standard", displayName: "星桥标准店" },
      { code: "apex-new", displayName: "极点新店" },
    ],
  },
  staff: {
    capabilities: ["store:perform-frontline"],
    label: "店员",
    persona: "周宁",
    scope: "棱镜旗舰店",
    scopeKind: "store",
    stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
  },
  manager: {
    capabilities: [
      "store:perform-frontline",
      "store:adjust-inventory",
      "store:configure",
      "store:manage-people",
      "audit:view",
    ],
    label: "店长",
    persona: "许知远",
    scope: "棱镜旗舰店",
    scopeKind: "store",
    stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
  },
  hq: {
    capabilities: [
      "store:configure",
      "chain:compare",
      "chain:configure",
      "audit:view",
    ],
    label: "总部运营",
    persona: "沈微",
    scope: "固定三店",
    scopeKind: "all-stores",
    stores: [
      { code: "prism-flagship", displayName: "棱镜旗舰店" },
      { code: "starbridge-standard", displayName: "星桥标准店" },
      { code: "apex-new", displayName: "极点新店" },
    ],
  },
} as const;

function roleContext(
  role: PublicRole,
  contextVersion: number,
  csrfToken: string,
  businessTime = "2026-08-09T11:30:00.000Z",
  advancedMilliseconds = 0,
): RoleContextReadyResponse {
  const details = roleDetails[role];
  return {
    status: "ready",
    csrfToken,
    contextVersion,
    role: { id: role, label: details.label },
    persona: { displayName: details.persona, protected: true },
    storeScope: {
      kind: details.scopeKind,
      label: details.scope,
      stores: [...details.stores],
    },
    capabilities: [...details.capabilities],
    sandbox: {
      schemaVersion: "4",
      seedVersion: "2026-08-09.1",
      expiresAt: "2026-08-10T12:00:00.000Z",
      businessClock: {
        advanceLimitMilliseconds: 86_400_000,
        advancedMilliseconds,
        currentTime: businessTime,
        remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
        timeZone: "Asia/Shanghai",
      },
    },
    freshness: {
      mode: "manual",
      observedAt: new Date().toISOString(),
    },
  };
}

function sandboxReady(role: PublicRole): PublicSandboxReadyResponse {
  const details = roleDetails[role];
  return {
    status: "ready",
    replayed: false,
    role,
    persona: { displayName: details.persona, scope: details.scope },
    world: {
      schemaVersion: "4",
      seedVersion: "2026-08-09.1",
      expiresAt: "2026-08-10T12:00:00.000Z",
      operator: { displayName: "竞枢演示经营方", city: "栖光市" },
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
    },
  };
}

test.beforeEach(async ({ context }) => {
  let hasSession = false;
  let currentRole: PublicRole = "staff";
  let contextVersion = 1;
  let csrfToken = "csrf-context-version-1-token-value";
  let businessTime = "2026-08-09T11:30:00.000Z";
  let advancedMilliseconds = 0;
  const attendanceShiftId = "00000000-0000-4000-8000-000000000971";
  let attendanceStatus: "checked-in" | "checked-out" | null = null;
  let attendanceOutcome: "late" | "on-time" | null = null;
  let attendanceCheckInAt: string | null = null;
  let attendanceCheckOutAt: string | null = null;
  const attendanceFacts: StaffShiftAttendanceResponse["shifts"]["future"] = [];
  const handoverId = "00000000-0000-4000-8000-000000000981";
  const incomingHandoverId = "00000000-0000-4000-8000-000000000982";
  let handoverSubmitted = false;
  let incomingConfirmed = false;
  let submittedNote = "";
  const handoverSnapshot: StaffHandoverSnapshot = {
    capturedAt: "2026-08-09T11:30:00.000Z",
    lowStockAlerts: [
      {
        availableQuantity: 2,
        displayName: "无品牌替换耳机",
        inventoryItemId: "00000000-0000-4000-8000-000000000985",
        lowStockThreshold: 3,
        onHandQuantity: 2,
        reservedQuantity: 0,
      },
    ],
    orders: [
      {
        lineSummary: "能量饮料 × 2",
        orderId: "00000000-0000-4000-8000-000000000984",
        seatCode: "B-03",
        status: "preparing",
      },
    ],
    repairs: [
      {
        description: "耳机右声道无声",
        priority: "high",
        repairId: "00000000-0000-4000-8000-000000000983",
        seatCode: "A-18",
        status: "assigned",
      },
    ],
    reservations: [
      {
        customerDisplayName: "林澈",
        endsAt: "2026-08-09T14:00:00.000Z",
        reservationId: "00000000-0000-4000-8000-000000000901",
        seatCode: "A-18",
        startsAt: "2026-08-09T12:00:00.000Z",
        status: "confirmed",
      },
    ],
  };
  const buildHandover = ({
    confirmed,
    id,
    note,
    submitter,
  }: {
    confirmed: boolean;
    id: string;
    note: string;
    submitter: string;
  }): StaffHandover => ({
    confirmed: confirmed
      ? {
          businessOccurredAt: businessTime,
          by: { displayName: "周宁", employeeCode: "PRISM-S001" },
          recordedAt: businessTime,
        }
      : null,
    handoverId: id,
    note,
    shiftId:
      id === handoverId
        ? attendanceShiftId
        : "00000000-0000-4000-8000-000000000986",
    snapshot: handoverSnapshot,
    submittedAt: {
      businessOccurredAt: "2026-08-09T11:25:00.000Z",
      recordedAt: "2026-08-09T11:25:02.000Z",
    },
    submittedBy: {
      displayName: submitter,
      employeeCode: submitter === "周宁" ? "PRISM-S001" : "PRISM-S002",
    },
  });
  const staffRows: MutableStaffReservationSummary[] = [
    {
      anomaly: null,
      area: { code: "competitive-a", displayName: "竞技区 A" },
      arrivalWindow: {
        closesAt: "2026-08-10T12:15:00.000Z",
        opensAt: "2026-08-10T11:30:00.000Z",
      },
      customer: { displayName: "林澈" },
      machineProfile: { code: "competitive", displayName: "竞技机型" },
      payableCents: 3_600,
      reservationId: "00000000-0000-4000-8000-000000000901",
      seat: { code: "A-18" },
      status: "confirmed",
      window: {
        endsAt: "2026-08-10T14:00:00.000Z",
        startsAt: "2026-08-10T12:00:00.000Z",
      },
    },
    {
      anomaly: null,
      area: { code: "competitive-b", displayName: "竞技区 B" },
      arrivalWindow: {
        closesAt: "2026-08-10T11:45:00.000Z",
        opensAt: "2026-08-10T11:00:00.000Z",
      },
      customer: { displayName: "顾辰" },
      machineProfile: { code: "competitive", displayName: "竞技机型" },
      payableCents: 3_600,
      reservationId: "00000000-0000-4000-8000-000000000902",
      seat: { code: "B-03" },
      status: "arrived",
      window: {
        endsAt: "2026-08-10T13:30:00.000Z",
        startsAt: "2026-08-10T11:30:00.000Z",
      },
    },
    {
      anomaly: null,
      area: { code: "flagship", displayName: "旗舰区" },
      arrivalWindow: {
        closesAt: "2026-08-10T11:15:00.000Z",
        opensAt: "2026-08-10T10:30:00.000Z",
      },
      customer: { displayName: "周屿" },
      machineProfile: { code: "flagship", displayName: "旗舰机型" },
      payableCents: 5_200,
      reservationId: "00000000-0000-4000-8000-000000000903",
      seat: { code: "C-01" },
      status: "in-use",
      window: {
        endsAt: "2026-08-10T13:00:00.000Z",
        startsAt: "2026-08-10T11:00:00.000Z",
      },
    },
    {
      anomaly: { code: "seat-maintenance", label: "座位维护中" },
      area: { code: "competitive-a", displayName: "竞技区 A" },
      arrivalWindow: {
        closesAt: "2026-08-10T10:45:00.000Z",
        opensAt: "2026-08-10T10:00:00.000Z",
      },
      customer: { displayName: "许泽" },
      machineProfile: { code: "competitive", displayName: "竞技机型" },
      payableCents: 3_600,
      reservationId: "00000000-0000-4000-8000-000000000904",
      seat: { code: "A-09" },
      status: "in-use",
      window: {
        endsAt: "2026-08-10T12:30:00.000Z",
        startsAt: "2026-08-10T10:30:00.000Z",
      },
    },
  ];
  const commandReasons = new Map<string, string>();
  const repairId = "00000000-0000-4000-8000-000000000916";
  const repairInventoryItemId = "00000000-0000-4000-8000-000000000917";
  const repairUsageId = "00000000-0000-4000-8000-000000000918";
  let repairStatus: RepairDetailResponse["status"] = "processing";
  let repairClaimedQuantity = 0;
  let repairReturnedQuantity = 0;
  let repairResolution: RepairDetailResponse["resolution"] = null;
  let latestVerification: RepairDetailResponse["latestVerification"] = null;
  const staffOrderRows: MutableStaffOrderSummary[] = [
    {
      amountCents: 1_100,
      couponLabel: "商品体验券",
      customerDisplayName: "林澈",
      itemSummary: "能量饮料 × 2",
      orderId: "00000000-0000-4000-8000-000000000951",
      reservation: {
        reservationId: "00000000-0000-4000-8000-000000000901",
        seatCode: "A-18",
        status: "in-use",
      },
      stageEnteredAt: "2026-08-10T11:18:00.000Z",
      status: "simulated-paid",
      waitingMinutes: 29,
    },
    {
      amountCents: 1_500,
      couponLabel: null,
      customerDisplayName: "顾辰",
      itemSummary: "烤肠 × 1 · 气泡水 × 1",
      orderId: "00000000-0000-4000-8000-000000000952",
      reservation: {
        reservationId: "00000000-0000-4000-8000-000000000902",
        seatCode: "B-03",
        status: "in-use",
      },
      stageEnteredAt: "2026-08-10T11:34:00.000Z",
      status: "ready-for-pickup",
      waitingMinutes: 13,
    },
  ];
  const inventoryItems: StoreInventoryResponse["items"][number][] = [
    {
      alerting: true,
      availableQuantity: 3,
      code: "peripheral-wipe",
      displayName: "外设清洁湿巾",
      inventoryItemId: "00000000-0000-4000-8000-000000000981",
      kind: "product",
      lowStockThreshold: 3,
      onHandQuantity: 9,
      recentMovement: null,
      reservedQuantity: 6,
    },
    {
      alerting: true,
      availableQuantity: 2,
      code: "spare-headset",
      displayName: "维修耳机",
      inventoryItemId: "00000000-0000-4000-8000-000000000982",
      kind: "spare",
      lowStockThreshold: 2,
      onHandQuantity: 2,
      recentMovement: null,
      reservedQuantity: 0,
    },
    {
      alerting: false,
      availableQuantity: 6,
      code: "spare-display-cable",
      displayName: "显示线",
      inventoryItemId: "00000000-0000-4000-8000-000000000983",
      kind: "spare",
      lowStockThreshold: 2,
      onHandQuantity: 6,
      recentMovement: null,
      reservedQuantity: 0,
    },
  ];
  const inventoryMovements: StoreInventoryResponse["movements"][number][] = [];
  const storeId = "00000000-0000-4000-8000-000000000111";
  const competitiveAreaId = "00000000-0000-4000-8000-000000000112";
  const draftAreaId = "00000000-0000-4000-8000-000000000113";
  const machineProfileId = "00000000-0000-4000-8000-000000000114";
  const busySeatId = "00000000-0000-4000-8000-000000000115";
  const pricePlanId = "00000000-0000-4000-8000-000000000116";
  const storeProductId = "00000000-0000-4000-8000-000000000117";
  let storeConfiguration: ManagerStoreConfigurationResponse = {
    areas: [
      {
        areaId: competitiveAreaId,
        businessReferenced: true,
        code: "competitive-a",
        displayName: "竞技区 A",
        lifecycleStatus: "active",
        seatCount: 1,
        sortOrder: 10,
        version: 3,
      },
      {
        areaId: draftAreaId,
        businessReferenced: false,
        code: "new-zone",
        displayName: "即将开放的超长区域名称用于验证窄屏换行而不是溢出布局",
        lifecycleStatus: "draft",
        seatCount: 0,
        sortOrder: 90,
        version: 1,
      },
    ],
    businessHours: {
      baseline: {
        closesAt: "00:00",
        closesNextDay: true,
        display: "24 小时",
        isOpen24Hours: true,
        opensAt: "00:00",
      },
      current: {
        closesAt: "00:00",
        closesNextDay: true,
        display: "24 小时",
        isOpen24Hours: true,
        opensAt: "00:00",
      },
      effective: [],
      scheduled: [],
    },
    currentTime: businessTime,
    machineProfiles: [
      {
        archived: false,
        code: "competitive",
        displayName: "竞技机型",
        experienceDescription: "高刷竞技配置",
        machineProfileId,
      },
    ],
    pricePlans: [
      {
        area: {
          areaId: competitiveAreaId,
          code: "competitive-a",
          displayName: "竞技区 A",
        },
        configVersion: 1,
        effectiveFrom: "2026-08-01T22:00:00.000Z",
        effectiveUntil: null,
        endsAt: "06:00",
        endsNextDay: true,
        machineProfile: {
          code: "competitive",
          displayName: "竞技机型",
          machineProfileId,
        },
        pricePlanId,
        startsAt: "06:00",
        status: "current",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        version: 1,
        weekdayHalfHourCents: 800,
        weekendHalfHourCents: 1_000,
      },
    ],
    products: [
      {
        alerting: false,
        archived: false,
        availableQuantity: 20,
        businessReferenced: true,
        headquartersProduct: {
          archived: false,
          category: "drink",
          code: "sparkling-water",
          description: "总部统一维护的虚构气泡水商品档案。",
          displayName: "栖光气泡水",
          productId: "00000000-0000-4000-8000-000000000118",
        },
        inventoryItemId: "00000000-0000-4000-8000-000000000119",
        listed: true,
        lowStockThreshold: 5,
        onHandQuantity: 24,
        reservedQuantity: 4,
        storeProductId,
        unitPriceCents: 600,
        version: 1,
      },
    ],
    seats: [
      {
        area: {
          areaId: competitiveAreaId,
          displayName: "竞技区 A",
        },
        businessReferenced: true,
        code: "A-18",
        dependencies: { activeReservations: 2, openRepairs: 1 },
        lifecycleStatus: "active",
        machineProfile: {
          code: "competitive",
          displayName: "竞技机型",
          machineProfileId,
        },
        operationalStatus: "normal",
        seatId: busySeatId,
        sortOrder: 18,
        version: 4,
      },
    ],
    status: "ready",
    store: {
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      fictitiousCity: "栖光市（虚构）",
      fixed: true,
      introduction:
        "96 座、24 小时运营的主演示门店，用于展示跨角色预约、订单与维修联动。",
      seatCount: 96,
      storeId,
      version: 5,
    },
  };
  const managerEmployeeIds = Array.from({ length: 16 }, () =>
    crypto.randomUUID(),
  );
  const managerShiftId = crypto.randomUUID();
  const managerAttendanceId = crypto.randomUUID();
  let managerPeople: ManagerPeopleScheduleResponse = {
    attendance: [
      {
        attendanceRecordId: managerAttendanceId,
        corrections: [],
        employee: {
          displayName: "周宁",
          employeeCode: "PRISM-S001",
          employeeId: managerEmployeeIds[0]!,
        },
        original: {
          absenceBusinessAt: null,
          checkInBusinessAt: "2026-08-09T12:08:00.000Z",
          checkInOutcome: "late",
          checkOutBusinessAt: "2026-08-09T20:03:00.000Z",
          status: "checked-out",
        },
        shiftId: managerShiftId,
        window: {
          endsAt: "2026-08-09T20:00:00.000Z",
          startsAt: "2026-08-09T12:00:00.000Z",
        },
      },
    ],
    coverageWarnings: [
      {
        actualStaff: 2,
        endsAt: "2026-08-11T04:00:00.000Z",
        minimumStaff: 3,
        startsAt: "2026-08-11T00:00:00.000Z",
      },
    ],
    currentTime: businessTime,
    employees: managerEmployeeIds.map((employeeId, index) => ({
      active: true,
      dependencies: {
        currentOrFutureShifts: index === 2 ? 1 : 0,
        futureShifts: index === 2 ? 1 : 0,
        openRepairAssignments: index === 2 ? 1 : 0,
      },
      displayName:
        index === 0 ? "周宁" : index === 1 ? "许知远" : `背景员工 ${index + 1}`,
      employeeCode: `PRISM-${index === 1 ? "M" : "S"}${String(index + 1).padStart(3, "0")}`,
      employeeId,
      protected: index < 2,
      role: index === 1 ? "manager" : "staff",
      store: {
        code: "prism-flagship",
        displayName: "棱镜旗舰店",
        fixed: true,
      },
      version: 1,
    })),
    shifts: [
      {
        attendanceRecordId: null,
        canManage: true,
        employee: {
          displayName: "背景员工 3",
          employeeCode: "PRISM-S003",
          employeeId: managerEmployeeIds[2]!,
          role: "staff",
        },
        endsAt: "2026-08-11T08:00:00.000Z",
        shiftId: managerShiftId,
        startsAt: "2026-08-11T00:00:00.000Z",
        status: "scheduled",
      },
    ],
    status: "ready",
    store: {
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      fixed: true,
      storeId,
    },
  };
  const managerDashboardKeys = [
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-09",
  ] as const;
  const dashboardDay = (key: string, index: number) => ({
    key,
    revenue: {
      orderCents: 2_600 + index * 100,
      reservationCents: 11_000 + index * 400,
      totalCents: 13_600 + index * 500,
    },
    seats: {
      businessSeatMinutes: 138_240,
      maintenanceMinutes: 2_880 + index * 20,
      maintenanceRateBasisPoints: 208 + index * 2,
      normalSeatMinutes: 135_360 - index * 20,
      operationalUtilizationBasisPoints: 7_500 + index * 55,
      usedMinutes: 101_520 + index * 700,
    },
  });
  function managerDashboardPayload(requestUrl: string) {
    const url = new URL(requestUrl);
    const from = url.searchParams.get("from") ?? managerDashboardKeys.at(-1)!;
    const to = url.searchParams.get("to") ?? managerDashboardKeys.at(-1)!;
    const drilldown = url.searchParams.get(
      "drilldown",
    ) as ManagerDashboardDrilldownKind | null;
    const selected = managerDashboardKeys
      .filter((key) => key >= from && key <= to)
      .map(dashboardDay);
    const current = selected.at(-1) ?? dashboardDay(to, 13);
    const objectType = {
      attendance: "attendance",
      evidence: "repair",
      handover: "handover",
      inventory: "inventory",
      orders: "order",
      repairs: "repair",
      revenue: "reservation",
      seats: "reservation",
    }[drilldown ?? "evidence"] as
      | "attendance"
      | "handover"
      | "inventory"
      | "order"
      | "repair"
      | "reservation";
    return {
      availableBusinessDays: managerDashboardKeys.map((key) => {
        const startsAt = new Date(`${key}T06:00:00.000+08:00`);
        return {
          endsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000).toISOString(),
          key,
          startsAt: startsAt.toISOString(),
        };
      }),
      currentTime: businessTime,
      days: selected,
      drilldown: drilldown
        ? {
            fromBusinessDay: from,
            kind: drilldown,
            rows: [
              {
                amountCents: drilldown === "revenue" ? 6_800 : null,
                businessDayKey: to,
                detail: "林澈 · A-18 · 服务端业务事实",
                objectId: "00000000-0000-4000-8000-000000000a22",
                objectType,
                occurredAt: businessTime,
                status: drilldown === "revenue" ? "completed" : "open",
                title:
                  drilldown === "revenue"
                    ? "预约 A-18 · 半小时价格片段"
                    : "当前范围经营记录",
              },
            ],
            storeCode: "prism-flagship",
            toBusinessDay: to,
          }
        : null,
      range: {
        endsAt: new Date(`${to}T06:00:00.000+08:00`).toISOString(),
        fromBusinessDay: from,
        preset: url.searchParams.has("from") ? "custom" : "current",
        startsAt: new Date(`${from}T06:00:00.000+08:00`).toISOString(),
        toBusinessDay: to,
      },
      recentEvidence: [
        {
          action: "repair.processing",
          businessDayKey: to,
          detail: "A-09 · 显示器间歇黑屏",
          objectId: "00000000-0000-4000-8000-000000000a23",
          objectType: "repair",
          occurredAt: businessTime,
          title: "报修状态更新",
        },
      ],
      status: "ready",
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      summary: {
        attendance: { absent: 1, late: 2, onTime: 11 },
        handoverExceptionCount: 1,
        inventory: { lowStockCount: 3 },
        orders: {
          backlogCount: 4,
          completedCount: 25,
          completionRateBasisPoints: 9_260,
          eligibleTerminalCount: 27,
          wasteCents: 2_600,
          wasteQuantity: 2,
        },
        repairs: {
          maintenanceMinutes: current.seats.maintenanceMinutes,
          medianResolutionMinutes: 45,
          openByPriority: { high: 1, normal: 0, urgent: 0 },
          openCount: 1,
        },
        revenue: current.revenue,
        seats: current.seats,
      },
      trend: managerDashboardKeys.slice(-7).map(dashboardDay),
    } satisfies ManagerDashboardResponse;
  }

  function staffOrderDetail(
    row: MutableStaffOrderSummary,
  ): StaffOrderDetailResponse {
    const primary =
      row.status === "simulated-paid"
        ? ({ kind: "start-preparing", label: "开始制作" } as const)
        : row.status === "preparing"
          ? ({ kind: "mark-ready", label: "标记待取" } as const)
          : row.status === "ready-for-pickup"
            ? ({ kind: "complete", label: "完成订单" } as const)
            : null;
    const hasPreparingEvent =
      row.status === "preparing" ||
      row.status === "ready-for-pickup" ||
      row.status === "completed";
    const hasReadyEvent =
      row.status === "ready-for-pickup" || row.status === "completed";
    return {
      actions: {
        canCancel: primary !== null,
        primary,
      },
      coupon: row.couponLabel
        ? {
            code: "PRODUCT-6",
            discountCents: 600,
            displayName: row.couponLabel,
            status: "reserved",
          }
        : null,
      currentTime: "2026-08-10T11:47:23.000Z",
      growth:
        row.status === "completed"
          ? { finalSimulatedAmountCents: row.amountCents, growthPoints: 11 }
          : null,
      inventory: [
        {
          inventoryItemId: "00000000-0000-4000-8000-000000000961",
          onHandQuantity: 12,
          productId: "00000000-0000-4000-8000-000000000962",
          quantity: 2,
          reservationStatus: row.status === "completed" ? "sold" : "active",
        },
      ],
      order: row,
      refund: null,
      snapshot: {
        coupon: row.couponLabel
          ? {
              code: "PRODUCT-6",
              discountCents: 600,
              displayName: row.couponLabel,
            }
          : null,
        discountCents: row.couponLabel ? 600 : 0,
        lines: [
          {
            lineTotalCents: 1_700,
            productId: "00000000-0000-4000-8000-000000000962",
            productName: "能量饮料",
            quantity: 2,
            unitPriceCents: 850,
          },
        ],
        payableCents: row.amountCents,
        reservation: {
          reservationId: row.reservation.reservationId,
          seatCode: row.reservation.seatCode,
          storeCode: "prism-flagship",
          storeDisplayName: "棱镜旗舰店",
        },
        subtotalCents: 1_700,
      },
      timeline: [
        {
          data: {},
          occurredAt: "2026-08-10T11:18:00.000Z",
          type: "order.inventory-reserved",
        },
        {
          data: { simulated: true },
          occurredAt: "2026-08-10T11:19:00.000Z",
          type: "order.simulated-payment-succeeded",
        },
        ...(hasPreparingEvent
          ? [
              {
                data: {},
                occurredAt: "2026-08-10T11:25:00.000Z",
                type: "order.preparing",
              },
            ]
          : []),
        ...(hasReadyEvent
          ? [
              {
                data: {},
                occurredAt: "2026-08-10T11:30:00.000Z",
                type: "order.ready-for-pickup",
              },
            ]
          : []),
      ],
    };
  }

  function staffDetail(
    row: StaffReservationSummary,
  ): StaffReservationDetailResponse {
    const primary =
      row.status === "confirmed"
        ? {
            kind: "arrive" as const,
            label: "办理到店" as const,
            requiresReason: false,
          }
        : row.status === "arrived"
          ? {
              kind: "start-use" as const,
              label: "开始使用" as const,
              requiresReason: false,
            }
          : row.status === "in-use"
            ? {
                kind: "complete-early" as const,
                label: "提前结束" as const,
                requiresReason: true,
              }
            : null;
    return {
      actions: {
        canCancel: row.status === "confirmed" || row.status === "arrived",
        primary,
      },
      arrivedAt:
        row.status === "arrived" || row.status === "in-use"
          ? "2026-08-10T11:25:00.000Z"
          : null,
      auditAvailable: currentRole === "manager",
      cancelledAt: row.status === "cancelled" ? businessTime : null,
      completedAt: row.status === "completed" ? businessTime : null,
      currentTime: "2026-08-10T11:47:23.000Z",
      refund:
        row.status === "cancelled"
          ? {
              amountCents: row.payableCents,
              occurredAt: businessTime,
              reason: commandReasons.get(row.reservationId) ?? "门店取消",
              simulated: true,
            }
          : null,
      related: { orders: [], repairs: [] },
      reservation: row,
      snapshot: {
        area: row.area,
        coupon: null,
        machineProfile: {
          ...row.machineProfile,
          experienceDescription: "高刷竞技配置",
        },
        price: {
          discountCents: 0,
          payableCents: row.payableCents,
          segments: [
            {
              amountCents: row.payableCents,
              endsAt: row.window.endsAt,
              multiplierBasisPoints: 12_000,
              rule: "weekday-evening",
              startsAt: row.window.startsAt,
            },
          ],
          subtotalCents: row.payableCents,
        },
        seat: row.seat,
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        window: row.window,
      },
      startedAt: row.status === "in-use" ? "2026-08-10T11:30:00.000Z" : null,
      terminalReason: commandReasons.get(row.reservationId) ?? null,
      timeline: [
        {
          data: {},
          occurredAt: "2026-08-10T10:00:00.000Z",
          type: "reservation.pending-created",
        },
        {
          data: { simulated: true },
          occurredAt: "2026-08-10T10:01:00.000Z",
          type: "reservation.simulated-payment-succeeded",
        },
        ...(row.status === "arrived" || row.status === "in-use"
          ? [
              {
                data: {},
                occurredAt: "2026-08-10T11:25:00.000Z",
                type: "reservation.arrived",
              },
            ]
          : []),
        ...(row.status === "in-use"
          ? [
              {
                data: {},
                occurredAt: "2026-08-10T11:30:00.000Z",
                type: "reservation.started",
              },
            ]
          : []),
      ],
    };
  }

  function repairDetail(): RepairDetailResponse {
    const consumedQuantity = repairClaimedQuantity - repairReturnedQuantity;
    return {
      actions: {
        canAssign: false,
        canClaimSpare: repairStatus === "processing",
        canReturnSpare:
          (repairStatus === "processing" || repairStatus === "verification") &&
          consumedQuantity > 0,
        canStart: false,
        canSubmitResolution: repairStatus === "processing",
        canVerify: repairStatus === "verification" && currentRole === "manager",
      },
      assignedTo: {
        displayName: "周宁",
        personaId: "00000000-0000-4000-8000-000000000921",
        role: "staff",
      },
      currentTime: businessTime,
      description: "耳机右声道无声",
      impacts: [],
      internal: {
        audits: [
          {
            action: "repair.spare.claim",
            actor: {
              displayName: "周宁",
              personaId: "00000000-0000-4000-8000-000000000921",
            },
            occurredAt: "2026-08-10T11:49:00.000Z",
            recordedAt: "2026-08-10T11:49:02.000Z",
            result: "allowed",
          },
        ],
        events: [
          {
            actor: {
              displayName: "周宁",
              personaId: "00000000-0000-4000-8000-000000000921",
            },
            occurredAt: "2026-08-10T11:49:00.000Z",
            recordedAt: "2026-08-10T11:49:02.000Z",
            type: "repair.spare-claimed",
          },
        ],
        notes: ["已复现右声道无声，准备更换备用耳机。"],
      },
      latestVerification,
      machineProfile: { code: "competitive", displayName: "竞技机型" },
      priority: "high",
      publicUpdates: [
        {
          note: "设备正在检修，座位暂时维护。",
          occurredAt: "2026-08-10T11:48:00.000Z",
          type: "repair.processing",
        },
      ],
      repairId,
      reservationId: "00000000-0000-4000-8000-000000000903",
      resolution: repairResolution,
      seat: {
        code: "A-18",
        operationalStatus: repairStatus === "closed" ? "normal" : "maintenance",
      },
      source: "customer",
      spares: {
        available: [
          {
            availableQuantity:
              2 - repairClaimedQuantity + repairReturnedQuantity,
            displayName: "无品牌替换耳机",
            inventoryItemId: repairInventoryItemId,
            onHandQuantity: 2 - repairClaimedQuantity + repairReturnedQuantity,
          },
        ],
        usages:
          repairClaimedQuantity > 0
            ? [
                {
                  claimedAt: "2026-08-10T11:49:00.000Z",
                  claimedBy: {
                    displayName: "周宁",
                    personaId: "00000000-0000-4000-8000-000000000921",
                  },
                  consumedQuantity,
                  inventoryItem: {
                    displayName: "无品牌替换耳机",
                    inventoryItemId: repairInventoryItemId,
                  },
                  movementId: "00000000-0000-4000-8000-000000000919",
                  quantity: repairClaimedQuantity,
                  recordedAt: "2026-08-10T11:49:02.000Z",
                  returnedQuantity: repairReturnedQuantity,
                  returns:
                    repairReturnedQuantity > 0
                      ? [
                          {
                            movementId: "00000000-0000-4000-8000-000000000920",
                            quantity: repairReturnedQuantity,
                            recordedAt: "2026-08-10T11:51:01.000Z",
                            returnedAt: "2026-08-10T11:51:00.000Z",
                            returnedBy: {
                              displayName: "周宁",
                              personaId: "00000000-0000-4000-8000-000000000921",
                            },
                            returnId: "00000000-0000-4000-8000-000000000922",
                          },
                        ]
                      : [],
                  usageId: repairUsageId,
                },
              ]
            : [],
      },
      status: repairStatus,
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
    };
  }

  await context.route("**/api/v1/staff/workbench", async (route) => {
    await route.fulfill({
      json: {
        businessDay: {
          endsAt: "2026-08-10T22:00:00.000Z",
          key: "2026-08-10",
          startsAt: "2026-08-09T22:00:00.000Z",
        },
        currentTime: "2026-08-10T11:47:23.000Z",
        queues: {
          anomalies: staffRows.filter((row) => row.anomaly),
          arrivalWindow: staffRows.filter((row) => row.status === "confirmed"),
          arrived: staffRows.filter((row) => row.status === "arrived"),
          inUse: staffRows.filter((row) => row.status === "in-use"),
        },
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/staff/handovers**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      expect(currentRole).toBe("staff");
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      if (pathname.endsWith("/confirmation")) {
        expect(pathname).toContain(incomingHandoverId);
        expect(request.postDataJSON()).toEqual({});
        incomingConfirmed = true;
        await route.fulfill({
          json: {
            ...buildHandover({
              confirmed: true,
              id: incomingHandoverId,
              note: "晚高峰到店窗口集中。",
              submitter: "赵一航",
            }),
            replayed: false,
          } satisfies HandoverCommandResponse,
          status: 200,
        });
        return;
      }
      const body = request.postDataJSON() as {
        note: string;
        shiftId: string;
      };
      expect(body.shiftId).toBe(attendanceShiftId);
      submittedNote = body.note;
      handoverSubmitted = true;
      await route.fulfill({
        json: {
          ...buildHandover({
            confirmed: false,
            id: handoverId,
            note: submittedNote,
            submitter: "周宁",
          }),
          replayed: false,
        } satisfies HandoverCommandResponse,
        status: 200,
      });
      return;
    }
    await route.fulfill({
      json: {
        currentTime: businessTime,
        employee: {
          displayName: "周宁",
          employeeCode: "PRISM-S001",
          role: "staff",
        },
        incoming: incomingConfirmed
          ? []
          : [
              {
                canConfirm: attendanceStatus === "checked-in",
                handover: buildHandover({
                  confirmed: false,
                  id: incomingHandoverId,
                  note: "晚高峰到店窗口集中。",
                  submitter: "赵一航",
                }),
              },
            ],
        outgoing: {
          canSubmit: attendanceStatus === "checked-in",
          handover: handoverSubmitted
            ? buildHandover({
                confirmed: false,
                id: handoverId,
                note: submittedNote,
                submitter: "周宁",
              })
            : null,
          shiftId: attendanceShiftId,
          snapshotPreview: handoverSnapshot,
          window: {
            endsAt: "2026-08-09T20:00:00.000Z",
            startsAt: "2026-08-09T12:00:00.000Z",
          },
        },
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      } satisfies StaffHandoversResponse,
      status: 200,
    });
  });
  await context.route("**/api/v1/manager/people-schedule**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      expect(currentRole).toBe("manager");
      await route.fulfill({ json: managerPeople, status: 200 });
      return;
    }
    expect(currentRole).toBe("manager");
    expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
    if (pathname.endsWith("/shift-preview")) {
      const body = request.postDataJSON() as ManagerShiftCoveragePreviewRequest;
      expect(body.startsAt).toBe("2026-08-13T11:30:00.000Z");
      expect(body.endsAt).toBe("2026-08-13T19:30:00.000Z");
      await route.fulfill({
        json: {
          status: "ready",
          validation: { status: "valid" },
          warnings: managerPeople.coverageWarnings,
        } satisfies ManagerShiftCoveragePreviewResponse,
        status: 200,
      });
      return;
    }
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    const body = request.postDataJSON() as ManagerPeopleCommandRequest;
    const objectId = crypto.randomUUID();
    if (body.action === "create-employee") {
      managerPeople = {
        ...managerPeople,
        employees: [
          ...managerPeople.employees,
          {
            active: true,
            dependencies: {
              currentOrFutureShifts: 0,
              futureShifts: 0,
              openRepairAssignments: 0,
            },
            displayName: body.displayName,
            employeeCode: body.employeeCode,
            employeeId: objectId,
            protected: false,
            role: body.employeeRole,
            store: {
              code: "prism-flagship",
              displayName: "棱镜旗舰店",
              fixed: true,
            },
            version: 1,
          },
        ],
      };
    } else if (body.action === "update-employee") {
      managerPeople = {
        ...managerPeople,
        employees: managerPeople.employees.map((employee) =>
          employee.employeeId === body.employeeId
            ? {
                ...employee,
                displayName: body.displayName,
                employeeCode: body.employeeCode,
                version: employee.version + 1,
              }
            : employee,
        ),
      };
    } else if (body.action === "deactivate-employee") {
      managerPeople = {
        ...managerPeople,
        employees: managerPeople.employees.map((employee) =>
          employee.employeeId === body.employeeId
            ? { ...employee, active: false, version: employee.version + 1 }
            : employee,
        ),
      };
    } else if (body.action === "correct-attendance") {
      managerPeople = {
        ...managerPeople,
        attendance: managerPeople.attendance.map((attendance) =>
          attendance.attendanceRecordId === body.attendanceRecordId
            ? {
                ...attendance,
                corrections: [
                  ...attendance.corrections,
                  {
                    businessOccurredAt: businessTime,
                    correctedBusinessAt: body.correctedBusinessAt,
                    correctedBy: "许知远",
                    correctionId: objectId,
                    correctionKind: body.correctionKind,
                    reason: body.reason,
                    recordedAt: businessTime,
                  },
                ],
              }
            : attendance,
        ),
      };
    }
    await route.fulfill({
      json: {
        action: body.action,
        coverageWarnings: managerPeople.coverageWarnings,
        objectId,
        replayed: false,
        status: "ready",
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/manager/dashboard**", async (route) => {
    expect(currentRole).toBe("manager");
    await route.fulfill({
      json: managerDashboardPayload(route.request().url()),
      status: 200,
    });
  });
  await context.route("**/api/v1/hq/people-schedule", async (route) => {
    expect(currentRole).toBe("hq");
    await route.fulfill({
      json: {
        currentTime: businessTime,
        status: "ready",
        stores: [
          {
            activeEmployeeCount: 7,
            attendanceAnomalyCount: 2,
            coverageWarnings: 18,
            employeeCount: 7,
            futureShiftCount: 21,
            managerCount: 1,
            staffCount: 6,
            store: { code: "apex-new", displayName: "极点新店" },
          },
          {
            activeEmployeeCount: 16,
            attendanceAnomalyCount: 1,
            coverageWarnings: 3,
            employeeCount: 16,
            futureShiftCount: 48,
            managerCount: 2,
            staffCount: 14,
            store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
          },
          {
            activeEmployeeCount: 10,
            attendanceAnomalyCount: 3,
            coverageWarnings: 9,
            employeeCount: 10,
            futureShiftCount: 30,
            managerCount: 1,
            staffCount: 9,
            store: {
              code: "starbridge-standard",
              displayName: "星桥标准店",
            },
          },
        ],
      } satisfies HeadquartersPeopleScheduleResponse,
      status: 200,
    });
  });
  await context.route(
    "**/api/v1/manager/handover-exceptions",
    async (route) => {
      expect(currentRole).toBe("manager");
      const frozen = buildHandover({
        confirmed: false,
        id: handoverId,
        note: "A-18 报修待分派。",
        submitter: "周宁",
      });
      await route.fulfill({
        json: {
          currentTime: businessTime,
          exceptions: [
            {
              businessOccurredAt: "2026-08-09T20:30:00.000Z",
              employee: {
                displayName: "周宁",
                employeeCode: "PRISM-S001",
              },
              handover: null,
              kind: "submission-overdue",
              recordedAt: "2026-08-09T20:30:01.000Z",
              shiftId: attendanceShiftId,
              window: {
                endsAt: "2026-08-09T20:00:00.000Z",
                startsAt: "2026-08-09T12:00:00.000Z",
              },
            },
            {
              businessOccurredAt: "2026-08-09T20:32:00.000Z",
              employee: {
                displayName: "周宁",
                employeeCode: "PRISM-S001",
              },
              handover: frozen,
              kind: "late-submission",
              recordedAt: "2026-08-09T20:32:02.000Z",
              shiftId: attendanceShiftId,
              window: {
                endsAt: "2026-08-09T20:00:00.000Z",
                startsAt: "2026-08-09T12:00:00.000Z",
              },
            },
            {
              businessOccurredAt: "2026-08-09T20:30:00.000Z",
              employee: {
                displayName: "周宁",
                employeeCode: "PRISM-S001",
              },
              handover: frozen,
              kind: "confirmation-overdue",
              recordedAt: "2026-08-09T20:30:01.000Z",
              shiftId: attendanceShiftId,
              window: {
                endsAt: "2026-08-09T20:00:00.000Z",
                startsAt: "2026-08-09T12:00:00.000Z",
              },
            },
          ],
          status: "ready",
          store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        } satisfies ManagerHandoverExceptionsResponse,
        status: 200,
      });
    },
  );
  await context.route("**/api/v1/staff/shifts**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname.endsWith("/attendance")) {
      expect(currentRole).toBe("staff");
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      if (request.headers()["x-test-attendance-slow"] === "1") {
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
      const body = request.postDataJSON() as {
        action: "manual-check-out" | "simulated-check-in";
      };
      if (body.action === "simulated-check-in") {
        attendanceStatus = "checked-in";
        attendanceOutcome = "on-time";
        attendanceCheckInAt = businessTime;
      } else {
        attendanceStatus = "checked-out";
        attendanceCheckOutAt = businessTime;
      }
      await route.fulfill({
        json: {
          action: body.action,
          occurredAt: businessTime,
          outcome: attendanceOutcome,
          replayed: request.headers()["x-test-attendance-replay"] === "1",
          shiftId: attendanceShiftId,
          status: attendanceStatus,
        },
        status: 200,
      });
      return;
    }
    const currentFacts: StaffShiftAttendanceResponse["shifts"]["current"] extends infer Current
      ? Current extends { facts: infer Facts }
        ? Facts
        : never
      : never = [
      ...(attendanceCheckInAt
        ? [
            {
              businessOccurredAt: attendanceCheckInAt,
              data: { outcome: attendanceOutcome, simulated: true },
              recordedAt: attendanceCheckInAt,
              type: "attendance.simulated-check-in" as const,
            },
          ]
        : []),
      ...(attendanceCheckOutAt
        ? [
            {
              businessOccurredAt: attendanceCheckOutAt,
              data: { source: "manual" },
              recordedAt: attendanceCheckOutAt,
              type: "attendance.manual-check-out" as const,
            },
          ]
        : []),
    ];
    await route.fulfill({
      json: {
        currentTime: businessTime,
        employee: {
          displayName: "周宁",
          employeeCode: "PRISM-S001",
          role: "staff",
        },
        shifts: {
          current: {
            attendance: attendanceStatus
              ? {
                  absence: null,
                  checkIn: attendanceCheckInAt
                    ? {
                        businessOccurredAt: attendanceCheckInAt,
                        outcome: attendanceOutcome,
                        recordedAt: attendanceCheckInAt,
                        source: "simulated",
                      }
                    : null,
                  checkOut: attendanceCheckOutAt
                    ? {
                        businessOccurredAt: attendanceCheckOutAt,
                        recordedAt: attendanceCheckOutAt,
                        source: "manual",
                      }
                    : null,
                  status: attendanceStatus,
                }
              : null,
            canManageSchedule: attendanceStatus === null,
            facts: currentFacts,
            nextAction:
              attendanceStatus === "checked-in"
                ? { kind: "manual-check-out", label: "手动签退" }
                : attendanceStatus === null
                  ? { kind: "simulated-check-in", label: "模拟签到" }
                  : null,
            shiftId: attendanceShiftId,
            signInWindow: {
              closesAt: "2026-08-09T20:00:00.000Z",
              opensAt: "2026-08-09T11:30:00.000Z",
            },
            window: {
              endsAt: "2026-08-09T20:00:00.000Z",
              startsAt: "2026-08-09T12:00:00.000Z",
            },
          },
          future: [
            {
              attendance: null,
              canManageSchedule: true,
              facts: [],
              nextAction: null,
              shiftId: "00000000-0000-4000-8000-000000000972",
              signInWindow: {
                closesAt: "2026-08-10T20:00:00.000Z",
                opensAt: "2026-08-10T11:30:00.000Z",
              },
              window: {
                endsAt: "2026-08-10T20:00:00.000Z",
                startsAt: "2026-08-10T12:00:00.000Z",
              },
            },
          ],
          recent: attendanceFacts,
        },
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      } satisfies StaffShiftAttendanceResponse,
      status: 200,
    });
  });
  await context.route("**/api/v1/staff/reservations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/commands")) {
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      const reservationId = url.pathname.split("/").at(-2) ?? "";
      const row = staffRows.find(
        (item) => item.reservationId === reservationId,
      );
      const body = request.postDataJSON() as {
        action: string;
        reason?: string;
      };
      if (!row) {
        await route.fulfill({ status: 404 });
        return;
      }
      if (body.reason) commandReasons.set(reservationId, body.reason);
      row.status =
        body.action === "arrive"
          ? "arrived"
          : body.action === "start-use"
            ? "in-use"
            : body.action === "cancel"
              ? "cancelled"
              : "completed";
      await route.fulfill({
        json: {
          action: body.action,
          occurredAt: businessTime,
          replayed: false,
          reservationId,
          status: row.status,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/v1/staff/reservations") {
      const status = url.searchParams.get("status");
      const anomaly = url.searchParams.get("anomaly");
      const search = url.searchParams.get("search")?.toLocaleLowerCase("zh-CN");
      const rows = staffRows.filter(
        (row) =>
          (status === "all" || row.status === status) &&
          (anomaly !== "only" || row.anomaly) &&
          (anomaly !== "none" || !row.anomaly) &&
          (!search ||
            `${row.customer.displayName} ${row.seat.code}`
              .toLocaleLowerCase("zh-CN")
              .includes(search)),
      );
      await route.fulfill({
        json: {
          businessDay: {
            endsAt: "2026-08-10T22:00:00.000Z",
            key: "2026-08-10",
            startsAt: "2026-08-09T22:00:00.000Z",
          },
          currentTime: "2026-08-10T11:47:23.000Z",
          filterOptions: {
            areas: [
              { code: "competitive-a", displayName: "竞技区 A" },
              { code: "competitive-b", displayName: "竞技区 B" },
              { code: "flagship", displayName: "旗舰区" },
            ],
            machineProfiles: [
              { code: "competitive", displayName: "竞技机型" },
              { code: "flagship", displayName: "旗舰机型" },
            ],
          },
          rows,
          status: "ready",
          store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        },
        status: 200,
      });
      return;
    }
    const reservationId = url.pathname.split("/").at(-1) ?? "";
    const row = staffRows.find((item) => item.reservationId === reservationId);
    await route.fulfill({
      json: row ? staffDetail(row) : { error: { message: "预约不存在" } },
      status: row ? 200 : 404,
    });
  });
  await context.route("**/api/v1/staff/orders**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/commands")) {
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      const orderId = url.pathname.split("/").at(-2) ?? "";
      const row = staffOrderRows.find((item) => item.orderId === orderId);
      const body = request.postDataJSON() as {
        action: "cancel" | "complete" | "mark-ready" | "start-preparing";
        reason?: string;
      };
      if (!row) {
        await route.fulfill({ status: 404 });
        return;
      }
      const previousStatus = row.status;
      await new Promise((resolve) => setTimeout(resolve, 250));
      row.status =
        body.action === "start-preparing"
          ? "preparing"
          : body.action === "mark-ready"
            ? "ready-for-pickup"
            : body.action === "complete"
              ? "completed"
              : "cancelled";
      await route.fulfill({
        json: {
          action: body.action,
          couponRestored: body.action === "cancel",
          growthPoints: body.action === "complete" ? 11 : 0,
          inventoryEffect:
            body.action === "complete"
              ? "sale"
              : body.action === "cancel"
                ? previousStatus === "preparing" ||
                  previousStatus === "ready-for-pickup"
                  ? "waste"
                  : "release"
                : "retain",
          occurredAt: businessTime,
          orderId,
          replayed: false,
          simulatedRefundCents: body.action === "cancel" ? row.amountCents : 0,
          status: row.status,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/v1/staff/orders") {
      const stage = url.searchParams.get("stage") ?? "all";
      const rows = staffOrderRows.filter((row) => {
        if (stage === "all") return true;
        if (stage === "exception") {
          return row.status === "cancelled" || row.status === "expired";
        }
        return row.status === stage;
      });
      await route.fulfill({
        json: {
          counts: {
            exception: staffOrderRows.filter(
              (row) => row.status === "cancelled" || row.status === "expired",
            ).length,
            preparing: staffOrderRows.filter(
              (row) => row.status === "preparing",
            ).length,
            "ready-for-pickup": staffOrderRows.filter(
              (row) => row.status === "ready-for-pickup",
            ).length,
            "simulated-paid": staffOrderRows.filter(
              (row) => row.status === "simulated-paid",
            ).length,
          },
          currentTime: "2026-08-10T11:47:23.000Z",
          rows,
          stage,
          status: "ready",
          store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        },
        status: 200,
      });
      return;
    }
    const orderId = url.pathname.split("/").at(-1) ?? "";
    const row = staffOrderRows.find((item) => item.orderId === orderId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      json: row ? staffOrderDetail(row) : { error: { message: "订单不存在" } },
      status: row ? 200 : 404,
    });
  });
  await context.route("**/api/v1/staff/repair-intake", async (route) => {
    await route.fulfill({
      json: {
        handlers: [
          {
            displayName: "周宁",
            personaId: "00000000-0000-4000-8000-000000000921",
            role: "staff",
          },
          {
            displayName: "许知远",
            personaId: "00000000-0000-4000-8000-000000000923",
            role: "manager",
          },
        ],
        seats: [
          {
            area: { code: "competitive-a", displayName: "竞技区 A" },
            code: "A-18",
            existingRepair: { repairId, status: repairStatus },
            id: "00000000-0000-4000-8000-000000000924",
            machineProfile: { code: "competitive", displayName: "竞技机型" },
            operationalStatus:
              repairStatus === "closed" ? "normal" : "maintenance",
            store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
          },
        ],
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/staff/repairs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname !== "/api/v1/staff/repairs"
    ) {
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (url.pathname.endsWith("/spares/claim")) {
        repairClaimedQuantity += Number(body.quantity);
        await route.fulfill({
          json: {
            action: "claim",
            businessOccurredAt: businessTime,
            inventoryItem: {
              displayName: "无品牌替换耳机",
              inventoryItemId: repairInventoryItemId,
            },
            movementId: "00000000-0000-4000-8000-000000000919",
            onHandAfter: 2 - repairClaimedQuantity,
            quantity: Number(body.quantity),
            recordedAt: businessTime,
            repairId,
            replayed: false,
            returnedQuantity: repairReturnedQuantity,
            usageId: repairUsageId,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/spares/return")) {
        repairReturnedQuantity += Number(body.quantity);
        await route.fulfill({
          json: {
            action: "return",
            businessOccurredAt: businessTime,
            inventoryItem: {
              displayName: "无品牌替换耳机",
              inventoryItemId: repairInventoryItemId,
            },
            movementId: "00000000-0000-4000-8000-000000000920",
            onHandAfter: 2 - repairClaimedQuantity + repairReturnedQuantity,
            quantity: Number(body.quantity),
            recordedAt: businessTime,
            repairId,
            replayed: false,
            returnedQuantity: repairReturnedQuantity,
            usageId: repairUsageId,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/resolution")) {
        repairStatus = "verification";
        repairResolution = {
          note: String(body.resolutionNote),
          submittedAt: businessTime,
          submittedBy: {
            displayName: "周宁",
            personaId: "00000000-0000-4000-8000-000000000921",
          },
        };
        await route.fulfill({
          json: {
            occurredAt: businessTime,
            recordedAt: businessTime,
            repairId,
            replayed: false,
            seatOperationalStatus: "maintenance",
            status: repairStatus,
          },
          status: 200,
        });
        return;
      }
      if (url.pathname.endsWith("/verification")) {
        const outcome = body.outcome as "failure" | "success";
        repairStatus = outcome === "success" ? "closed" : "processing";
        latestVerification = {
          outcome,
          reason: String(body.reason),
          verifiedAt: businessTime,
          verifiedBy: {
            displayName: "许知远",
            personaId: "00000000-0000-4000-8000-000000000923",
          },
        };
        await route.fulfill({
          json: {
            occurredAt: businessTime,
            outcome,
            recordedAt: businessTime,
            repairId,
            replayed: false,
            seatOperationalStatus:
              outcome === "success" ? "normal" : "maintenance",
            status: repairStatus,
          },
          status: 200,
        });
        return;
      }
    }
    await route.fulfill({
      json: {
        currentTime: businessTime,
        rows: [
          {
            createdAt: "2026-08-10T11:42:00.000Z",
            description: "耳机右声道无声",
            machineProfile: { code: "competitive", displayName: "竞技机型" },
            priority: "high",
            repairId,
            seat: { code: "A-18" },
            source: "customer",
            status: repairStatus,
            waitingMinutes: 7,
          },
        ],
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/repairs/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/images")) {
      await route.fulfill({
        json: { images: [], status: "ready" },
        status: 200,
      });
      return;
    }
    await route.fulfill({ json: repairDetail(), status: 200 });
  });
  await context.route("**/api/v1/store/inventory**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/commands")) {
      expect(currentRole).toBe("manager");
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      const body = request.postDataJSON() as
        | {
            action: "receipt";
            inventoryItemId: string;
            quantity: number;
            reason: string;
          }
        | {
            action: "stocktake";
            actualQuantity: number;
            inventoryItemId: string;
            reason: string;
          }
        | {
            action: "compensation";
            inventoryItemId: string;
            onHandDelta: number;
            originalMovementId: string | null;
            reason: string;
          };
      const item = inventoryItems.find(
        (candidate) => candidate.inventoryItemId === body.inventoryItemId,
      )!;
      const beforeAlerting = item.alerting;
      const onHandDelta =
        body.action === "receipt"
          ? body.quantity
          : body.action === "stocktake"
            ? body.actualQuantity - item.onHandQuantity
            : body.onHandDelta;
      item.onHandQuantity += onHandDelta;
      item.availableQuantity = item.onHandQuantity - item.reservedQuantity;
      item.alerting = item.availableQuantity <= item.lowStockThreshold;
      const movementId = crypto.randomUUID();
      const movement: StoreInventoryResponse["movements"][number] = {
        businessOccurredAt: businessTime,
        inventoryItemId: item.inventoryItemId,
        inventoryItemName: item.displayName,
        kind: body.action,
        movementId,
        onHandAfter: item.onHandQuantity,
        onHandDelta,
        orderId: null,
        originalMovementId:
          body.action === "compensation" ? body.originalMovementId : null,
        reason: body.reason,
      };
      inventoryMovements.unshift(movement);
      item.recentMovement = movement;
      await route.fulfill({
        json: {
          action: body.action,
          alerting: item.alerting,
          alertTransition:
            beforeAlerting === item.alerting
              ? "unchanged"
              : item.alerting
                ? "activated"
                : "resolved",
          businessOccurredAt: businessTime,
          inventoryItemId: item.inventoryItemId,
          movementId,
          onHandAfter: item.onHandQuantity,
          onHandDelta,
          originalMovementId: movement.originalMovementId,
          reason: body.reason,
          replayed: false,
        },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      json: {
        currentTime: businessTime,
        items: inventoryItems,
        movements: inventoryMovements,
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        summary: {
          alertCount: inventoryItems.filter((item) => item.alerting).length,
          itemCount: 20,
          productCount: 12,
          spareCount: 8,
        },
      } satisfies StoreInventoryResponse,
      status: 200,
    });
  });

  await context.route(
    "**/api/v1/manager/store-configuration**",
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({ json: storeConfiguration, status: 200 });
        return;
      }
      expect(currentRole).toBe("manager");
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      if (request.url().endsWith("/price-overlap-preview")) {
        await route.fulfill({
          json: { overlap: null, status: "ready" },
          status: 200,
        });
        return;
      }
      expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
      const body =
        request.postDataJSON() as ManagerStoreConfigurationCommandRequest;
      if (body.action === "update-store-profile") {
        storeConfiguration = {
          ...storeConfiguration,
          store: {
            ...storeConfiguration.store,
            displayName: body.displayName,
            fictitiousCity: body.fictitiousCity,
            introduction: body.introduction,
            version: storeConfiguration.store.version + 1,
          },
        };
      } else if (body.action === "schedule-business-hours") {
        expect(body.effectiveFrom).toBe("2026-08-10T11:30:00.000Z");
        storeConfiguration = {
          ...storeConfiguration,
          businessHours: {
            ...storeConfiguration.businessHours,
            scheduled: [
              ...storeConfiguration.businessHours.scheduled,
              {
                businessHoursId: crypto.randomUUID(),
                closesAt: body.closesAt,
                closesNextDay: body.closesNextDay,
                daySet: body.daySet,
                effectiveFrom: body.effectiveFrom,
                isOpen24Hours: body.isOpen24Hours,
                opensAt: body.opensAt,
              },
            ],
          },
          store: {
            ...storeConfiguration.store,
            version: storeConfiguration.store.version + 1,
          },
        };
      } else if (body.action === "create-area") {
        expect(body.code).toBe("quiet-zone");
        storeConfiguration = {
          ...storeConfiguration,
          areas: [
            ...storeConfiguration.areas,
            {
              areaId: crypto.randomUUID(),
              businessReferenced: false,
              code: body.code,
              displayName: body.displayName,
              lifecycleStatus: body.lifecycleStatus,
              seatCount: 0,
              sortOrder: body.sortOrder,
              version: 1,
            },
          ],
          store: {
            ...storeConfiguration.store,
            version: storeConfiguration.store.version + 1,
          },
        };
      } else if (body.action === "create-price-plan") {
        const area = storeConfiguration.areas.find(
          (candidate) => candidate.areaId === body.areaId,
        )!;
        const profile = storeConfiguration.machineProfiles.find(
          (candidate) => candidate.machineProfileId === body.machineProfileId,
        )!;
        storeConfiguration = {
          ...storeConfiguration,
          pricePlans: [
            ...storeConfiguration.pricePlans.map((plan) =>
              plan.area.areaId === body.areaId &&
              plan.machineProfile.machineProfileId === body.machineProfileId &&
              plan.startsAt === body.startsAt &&
              plan.endsAt === body.endsAt &&
              plan.endsNextDay === body.endsNextDay
                ? { ...plan, effectiveUntil: body.effectiveFrom }
                : plan,
            ),
            {
              area: {
                areaId: area.areaId,
                code: area.code,
                displayName: area.displayName,
              },
              configVersion: 1,
              effectiveFrom: body.effectiveFrom,
              effectiveUntil: null,
              endsAt: body.endsAt,
              endsNextDay: body.endsNextDay,
              machineProfile: {
                code: profile.code,
                displayName: profile.displayName,
                machineProfileId: profile.machineProfileId,
              },
              pricePlanId: crypto.randomUUID(),
              startsAt: body.startsAt,
              status: "scheduled",
              store: {
                code: storeConfiguration.store.code,
                displayName: storeConfiguration.store.displayName,
              },
              version: 2,
              weekdayHalfHourCents: body.weekdayHalfHourCents,
              weekendHalfHourCents: body.weekendHalfHourCents,
            },
          ],
          store: {
            ...storeConfiguration.store,
            version: storeConfiguration.store.version + 1,
          },
        };
      } else if (body.action === "archive-price-plan") {
        storeConfiguration = {
          ...storeConfiguration,
          pricePlans: storeConfiguration.pricePlans.map((plan) =>
            plan.pricePlanId === body.pricePlanId
              ? { ...plan, status: "archived" }
              : plan,
          ),
        };
      } else if (body.action === "update-store-product") {
        storeConfiguration = {
          ...storeConfiguration,
          products: storeConfiguration.products.map((product) =>
            product.storeProductId === body.storeProductId
              ? {
                  ...product,
                  alerting: product.availableQuantity <= body.lowStockThreshold,
                  listed: body.listed,
                  lowStockThreshold: body.lowStockThreshold,
                  unitPriceCents: body.unitPriceCents,
                  version: product.version + 1,
                }
              : product,
          ),
        };
      } else if (body.action === "archive-store-product") {
        storeConfiguration = {
          ...storeConfiguration,
          products: storeConfiguration.products.map((product) =>
            product.storeProductId === body.storeProductId
              ? {
                  ...product,
                  archived: true,
                  listed: false,
                  version: product.version + 1,
                }
              : product,
          ),
        };
      }
      await route.fulfill({
        json: {
          action: body.action,
          objectId: "00000000-0000-4000-8000-000000000111",
          replayed: false,
          version: storeConfiguration.store.version,
        },
        status: 200,
      });
    },
  );

  await context.route("**/api/v1/customer/stores", async (route) => {
    await route.fulfill({
      json: {
        error: {
          code: "CUSTOMER_STORE_CATALOG_UNAVAILABLE",
          message: "共享壳层测试不加载顾客门店目录。",
          requestId: "00000000-0000-4000-8000-000000000607",
        },
      },
      status: 503,
    });
  });

  await context.route("**/api/v1/public/visitor", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await context.route("**/api/v1/public/sandboxes", async (route) => {
    currentRole = route.request().postDataJSON().role as PublicRole;
    contextVersion = 1;
    csrfToken = "csrf-context-version-1-token-value";
    businessTime = "2026-08-09T11:30:00.000Z";
    advancedMilliseconds = 0;
    hasSession = true;
    await route.fulfill({ json: sandboxReady(currentRole), status: 201 });
  });
  const serveContext = async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.headers()["x-test-context-required"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "ROLE_CONTEXT_REQUIRED",
            message: "演示角色上下文已失效，请返回公开入口重新选择。",
            requestId: "00000000-0000-4000-8000-000000000304",
          },
        },
        status: 401,
      });
      return;
    }
    if (pathname.endsWith("/switch")) {
      if (request.headers()["x-test-context-unavailable"] === "1") {
        await route.fulfill({
          json: {
            error: {
              code: "ROLE_CONTEXT_UNAVAILABLE",
              message: "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
              requestId: "00000000-0000-4000-8000-000000000303",
            },
          },
          status: 401,
        });
        return;
      }
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      const body = request.postDataJSON() as { targetRole: PublicRole };
      currentRole = body.targetRole;
      contextVersion += 1;
      csrfToken = `csrf-context-version-${contextVersion}-token-value`;
      if (request.headers()["x-test-response-lost"] === "1") {
        await route.abort("failed");
        return;
      }
      if (request.headers()["x-test-result-unknown"] === "1") {
        await route.fulfill({
          json: {
            error: {
              code: "ROLE_CONTEXT_SWITCH_FAILED",
              message: "角色切换结果未确认；请刷新到服务端当前角色。",
              requestId: "00000000-0000-4000-8000-000000000302",
            },
          },
          status: 503,
        });
        return;
      }
      await route.fulfill({
        json: roleContext(
          currentRole,
          contextVersion,
          csrfToken,
          businessTime,
          advancedMilliseconds,
        ),
        status: 200,
      });
      return;
    }

    if (pathname.endsWith("/refresh")) {
      const refresh = request.postDataJSON() as {
        mode: "canonical" | "switch-outcome-unknown";
        pageContextVersion?: number;
      };
      expect(refresh.mode).toMatch(/canonical|switch-outcome-unknown/u);
      if (refresh.mode === "switch-outcome-unknown") {
        expect(refresh.pageContextVersion).toEqual(expect.any(Number));
      }
    }

    if (!hasSession) {
      await route.fulfill({
        json: {
          error: {
            code: "ROLE_CONTEXT_REQUIRED",
            message: "演示角色上下文已失效，请返回公开入口重新选择。",
            requestId: "00000000-0000-4000-8000-000000000301",
          },
        },
        status: 401,
      });
      return;
    }
    await route.fulfill({
      json: roleContext(
        currentRole,
        contextVersion,
        csrfToken,
        businessTime,
        advancedMilliseconds,
      ),
      status: 200,
    });
  };
  await context.route("**/api/v1/demo/context", serveContext);
  await context.route("**/api/v1/demo/context/refresh", serveContext);
  await context.route("**/api/v1/demo/context/switch", serveContext);
  await context.route("**/api/v1/demo/time", async (route) => {
    const current = new Date(businessTime);
    const halfHour = new Date(current.getTime() + 30 * 60_000).toISOString();
    const nextEvent = new Date(current.getTime() + 15 * 60_000).toISOString();
    await route.fulfill({
      json: {
        status: "ready",
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds,
          currentTime: businessTime,
          remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
          timeZone: "Asia/Shanghai",
        },
        halfHour: {
          afterTime: halfHour,
          impacts: [{ count: 2, kind: "pending-order-expiration" }],
        },
        nextEvent: {
          afterTime: nextEvent,
          impacts: [{ count: 1, kind: "reservation-no-show" }],
        },
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/demo/time/advance", async (route) => {
    const request = route.request();
    expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    if (request.headers()["x-test-advance-failed"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "DEMO_TIME_ADVANCE_FAILED",
            message:
              "到期处理未能全部完成，时钟和业务状态均未改变；可以安全重试。",
            requestId: "00000000-0000-4000-8000-000000000505",
          },
        },
        status: 503,
      });
      return;
    }
    const body = request.postDataJSON() as {
      mode: "half-hour" | "next-event";
    };
    const beforeTime = businessTime;
    const advanceBy = body.mode === "half-hour" ? 30 * 60_000 : 15 * 60_000;
    businessTime = new Date(
      new Date(businessTime).getTime() + advanceBy,
    ).toISOString();
    advancedMilliseconds += advanceBy;
    await route.fulfill({
      json: {
        status: "advanced",
        replayed: false,
        mode: body.mode,
        beforeTime,
        afterTime: businessTime,
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds,
          remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
          timeZone: "Asia/Shanghai",
        },
        impacts:
          body.mode === "half-hour"
            ? [{ count: 2, kind: "pending-order-expiration" }]
            : [{ count: 1, kind: "reservation-no-show" }],
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/demo/reset", async (route) => {
    const request = route.request();
    expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    if (request.headers()["x-test-reset-failed"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "SANDBOX_RESET_FAILED",
            message: "全新沙箱创建失败，当前沙箱仍完整保留；可以安全重试。",
            requestId: "00000000-0000-4000-8000-000000000506",
          },
        },
        status: 503,
      });
      return;
    }
    currentRole = "customer";
    contextVersion = 1;
    csrfToken = "csrf-reset-sandbox-version-1-token-value";
    businessTime = "2026-08-09T11:30:00.000Z";
    advancedMilliseconds = 0;
    await route.fulfill({
      json: {
        status: "ready",
        replayed: false,
        previousSandboxInvalidated: true,
        result: {
          targetRole: "customer",
          persona: { displayName: "林澈" },
          sandbox: {
            ...roleContext(
              currentRole,
              contextVersion,
              csrfToken,
              businessTime,
              advancedMilliseconds,
            ).sandbox,
          },
        },
        context: roleContext(
          currentRole,
          contextVersion,
          csrfToken,
          businessTime,
          advancedMilliseconds,
        ),
      },
      status: 201,
    });
  });
});

async function enterStaffShell(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /进入店员演示/u }).click();
  await expect(
    page.getByRole("heading", { name: "沙箱已准备完成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "进入店员视图" }).click();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
}

async function enterManagerStoreConfiguration(page: Page) {
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await page.getByRole("button", { name: "门店配置" }).click();
  await expect(page.getByRole("heading", { name: "门店配置" })).toBeVisible();
}

async function enterManagerDashboard(page: Page) {
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await expect(page.getByRole("heading", { name: "经营看板" })).toBeVisible();
  await expect(page.getByText("模拟营业额", { exact: true })).toBeVisible();
}

test("manager dashboard keeps real metrics, ranges and drilldowns in one store context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterManagerDashboard(page);

  await expect(page.getByText("运营座位利用率", { exact: true })).toBeVisible();
  await expect(page.getByText("维护不可用率", { exact: true })).toBeVisible();
  await expect(page.getByText("订单完成率", { exact: true })).toBeVisible();
  await expect(page.getByText("3 人次", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "最近 7 日" }).click();
  await expect(page.getByText(/2026-08-03 至 2026-08-09/u)).toBeVisible();

  await page
    .getByRole("button")
    .filter({ hasText: "模拟营业额" })
    .first()
    .click();
  const drilldown = page.getByRole("dialog", { name: "模拟营业额构成" });
  await expect(drilldown).toBeVisible();
  await expect(
    drilldown.getByText("prism-flagship", { exact: false }),
  ).toHaveCount(0);
  await expect(drilldown.getByText(/2026-08-03 至 2026-08-09/u)).toBeVisible();
  await expect(drilldown.getByText("预约 A-18 · 半小时价格片段")).toBeVisible();
  await drilldown.getByRole("button", { name: "关闭指标下钻" }).click();

  await page.locator(".manager-dashboard-range summary").click();
  await page.getByLabel("起始经营日").selectOption("2026-08-05");
  await page.getByLabel("结束经营日").selectOption("2026-08-07");
  await page.getByRole("button", { name: "应用范围" }).click();
  await expect(page.getByText(/2026-08-05 至 2026-08-07/u)).toBeVisible();

  const widths = await page.evaluate(() => ({
    client: document.body.clientWidth,
    scroll: document.body.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
});

test("manager dashboard failure stays actionable and retries without fallback data", async ({
  page,
}) => {
  let first = true;
  await page.route("**/api/v1/manager/dashboard**", async (route) => {
    if (first) {
      first = false;
      await route.fulfill({
        json: {
          error: {
            code: "MANAGER_DASHBOARD_SERVICE_UNAVAILABLE",
            message: "经营事实服务暂时不可用。",
            requestId: crypto.randomUUID(),
          },
        },
        status: 503,
      });
      return;
    }
    await route.fallback();
  });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "当前页面没有用预置数字替代服务端结果。",
    }),
  ).toBeVisible();
  await expect(page.getByText("经营事实服务暂时不可用。")).toBeVisible();
  await page.getByRole("button", { name: "重新读取经营看板" }).click();
  await expect(page.getByRole("heading", { name: "经营看板" })).toBeVisible();
});

test("staff sees own shift summary, explicit simulation boundary and manual attendance actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route("**/api/v1/staff/shifts/*/attendance", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-attendance-slow": "1",
      },
    });
  });
  await enterStaffShell(page);
  await expect(page.getByText("本人班次", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "班次与交接" }).click();
  await expect(page.getByRole("heading", { name: "班次与交接" })).toBeVisible();
  await expect(page.getByText("模拟考勤，不连接真实设备")).toBeVisible();
  await expect(page.getByText(/不读取定位、人脸或门禁/u)).toBeVisible();
  await expect(page.getByText("周宁 · PRISM-S001")).toBeVisible();
  await expect(page.getByRole("heading", { name: "未来班次" })).toBeVisible();

  const checkIn = page.getByRole("button", { name: "模拟签到" });
  await checkIn.focus();
  await expect(checkIn).toBeFocused();
  await checkIn.press("Enter");
  const processing = page.getByRole("button", { name: "处理中…" });
  await expect(processing).toBeDisabled();
  await expect(page.getByRole("button", { name: "手动签退" })).toBeVisible();
  await expect(page.getByText("员工模拟签到")).toBeVisible();
  await page.getByRole("button", { name: "手动签退" }).click();
  await expect(page.getByText("当前没有可执行动作")).toBeVisible();
  await expect(
    page.getByText("员工手动签退", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("系统未自动补写时间")).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("staff receives explicit safe-replay feedback for a duplicate attendance submission", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.route("**/api/v1/staff/shifts/*/attendance", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-attendance-replay": "1",
      },
    });
  });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "班次与交接" }).click();
  await page.getByRole("button", { name: "模拟签到" }).click();
  await expect(
    page.getByText("同一考勤请求已安全重放，原始事实没有重复写入。"),
  ).toBeVisible();
});

test("staff freezes a handover snapshot, signs out immediately, and confirms another employee handover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "班次与交接" }).click();
  await page.getByRole("button", { name: "模拟签到" }).click();
  await expect(page.getByRole("button", { name: "手动签退" })).toBeVisible();

  await page.getByRole("button", { name: "交接班" }).click();
  await expect(page.getByText("只交接经营事项，不收集敏感数据")).toBeVisible();
  await expect(
    page.getByText("未完成预约", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("林澈", { exact: false }).first()).toBeVisible();
  const note = page.getByRole("textbox", { name: /补充说明/u });
  await note.fill("A-18 报修待分派；晚高峰到店窗口集中。");
  await page.getByRole("button", { name: "提交不可编辑交接" }).click();
  await expect(page.getByText("快照与说明已冻结")).toBeVisible();
  await expect(note).toBeDisabled();
  await expect(
    page.getByText("现在即可手动签退", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("真实服务器记录", { exact: false }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "确认承接" }).click();
  await expect(page.getByText("当前没有待本人确认的同店交接。")).toBeVisible();
  await expect(
    page.getByText("接班确认已记录，业务时间与真实服务器时间均可追溯。"),
  ).toBeVisible();

  await page.getByRole("button", { name: "本人班次" }).click();
  await page.getByRole("button", { name: "手动签退" }).click();
  await expect(page.getByText("当前没有可执行动作")).toBeVisible();
});

test("manager maintains owned-store employees, previews savable coverage warnings, and appends attendance corrections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "员工与排班" }).click();

  await expect(
    page.getByRole("heading", { name: "员工、排班与考勤" }),
  ).toBeVisible();
  await expect(page.getByText("所属门店员工")).toBeVisible();
  await expect(page.getByLabel("编辑 周宁")).toBeDisabled();
  await expect(page.getByLabel("停用 许知远")).toBeDisabled();

  const dependentDeactivate = page.getByLabel("停用 背景员工 3");
  await dependentDeactivate.click();
  await expect(
    page.getByText("存在依赖，必须先处理以上班次或报修分派。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认停用" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dependentDeactivate).toBeFocused();

  const createEmployee = page.getByRole("button", { name: "创建背景员工" });
  await createEmployee.click();
  await expect(page.getByLabel("员工工作名")).toBeFocused();
  await page.getByLabel("员工工作名").fill("夜班增援");
  await page.getByLabel("员工编号").fill("PRISM-S017");
  await page.getByRole("button", { name: "保存员工" }).click();
  await expect(page.getByText("背景员工已创建")).toBeVisible();
  await expect(page.getByText("夜班增援")).toBeVisible();

  await page.getByRole("button", { name: /未来排班/u }).click();
  await expect(page.getByText("未来排班时间轴")).toBeVisible();
  await expect(page.getByText("人员覆盖不足", { exact: false })).toBeVisible();
  const createShift = page.getByRole("button", {
    name: "创建班次",
    exact: true,
  });
  await createShift.click();
  const shiftDialog = page.getByRole("dialog", { name: "创建未来班次" });
  await expect(
    shiftDialog.getByRole("combobox", { name: "员工", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("覆盖不足，但允许保存")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保留告警并保存" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(createShift).toBeFocused();

  await page.getByRole("button", { name: /考勤与交接/u }).click();
  await expect(page.getByText("原始事实 · 不可编辑")).toBeVisible();
  const correctionTrigger = page.getByRole("button", { name: "创建更正" });
  await correctionTrigger.click();
  await expect(page.getByLabel("更正类型")).toBeFocused();
  await page
    .getByLabel(/更正原因/u)
    .fill("已核对当班交接记录，确认实际到岗时间。");
  await page.getByRole("button", { name: "追加更正" }).click();
  await expect(page.getByText("考勤更正已追加，原始事实未覆盖")).toBeVisible();
  await expect(page.getByText("已核对当班交接记录")).toBeVisible();

  await page.getByRole("button", { name: "查看交接快照" }).click();
  const handoverDialog = page.getByRole("dialog", {
    name: "交接异常与冻结快照",
  });
  await expect(handoverDialog).toBeVisible();
  await expect(
    handoverDialog.getByRole("button", { name: /^逾期未提交/u }),
  ).toBeVisible();
  await expect(
    handoverDialog.getByRole("button", { name: /^迟交/u }),
  ).toBeVisible();
  await expect(
    handoverDialog.getByRole("button", { name: /^长期未确认/u }),
  ).toBeVisible();
  await handoverDialog.getByRole("button", { name: /^迟交/u }).click();
  await expect(page.getByText("A-18 报修待分派。")).toBeVisible();
  await expect(page.getByText("业务发生", { exact: true })).toBeVisible();
  await expect(page.getByText("真实服务器记录", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await handoverDialog.getByRole("button", { name: "完成查看" }).click();

  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("headquarters sees only the three-store people and schedule summary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "总部运营 沈微 · 虚构人物 固定三店",
    })
    .click();
  await page.getByRole("button", { name: "人员与排班" }).click();

  await expect(
    page.getByRole("heading", { name: "人员与排班汇总" }),
  ).toBeVisible();
  await expect(page.getByText("全门店只读")).toBeVisible();
  await expect(page.getByRole("heading", { name: "棱镜旗舰店" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "星桥标准店" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "极点新店" })).toBeVisible();
  await expect(page.getByText("考勤异常", { exact: true })).toHaveCount(3);
  await expect(page.locator(".people-hq-grid").getByRole("button")).toHaveCount(
    0,
  );
});

test("manager edits only the owned store through dedicated configuration forms and sees seat dependencies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await page.getByRole("button", { name: "门店配置" }).click();

  await expect(page.getByRole("heading", { name: "门店配置" })).toBeVisible();
  await expect(
    page.getByText("固定演示门店 · 不可新增、删除或停用门店"),
  ).toBeVisible();
  await expect(page.getByLabel("虚构城市")).toHaveValue("栖光市（虚构）");
  const effectiveHours = page
    .locator(".store-config-scheduled-hours")
    .filter({ hasText: "默认回退与各适用日已生效版本" });
  await expect(effectiveHours).toContainText("默认回退");
  await expect(effectiveHours).toContainText("尚无各适用日已生效版本");

  await page.getByLabel("门店工作名称").fill("尚未提交的门店名称");

  const hoursTrigger = page.getByRole("button", { name: "新建规则" });
  await hoursTrigger.click();
  await expect(page.getByLabel("适用日")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(hoursTrigger).toBeFocused();
  await hoursTrigger.click();
  const hoursDialog = page.getByRole("dialog", { name: "创建未来营业规则" });
  await hoursDialog.getByLabel("适用日").selectOption("weekends");
  await hoursDialog.getByRole("button", { name: "创建未来规则" }).click();
  await expect(
    page.getByText("未来营业规则已创建，当前营业时间保持不变"),
  ).toBeVisible();
  await expect(page.getByLabel("门店工作名称")).toHaveValue(
    "尚未提交的门店名称",
  );
  await expect(page.getByText("周末", { exact: true })).toBeVisible();
  await expect(page.getByText("24 小时", { exact: true })).toBeVisible();

  await page.getByLabel("门店工作名称").fill("棱镜旗舰演示店");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("门店展示资料已由服务端确认保存")).toBeVisible();
  await expect(page.getByText("棱镜旗舰演示店 · 固定所属门店")).toBeVisible();

  await page.getByRole("tab", { name: /区域与座位/u }).click();
  await expect(
    page.getByText("即将开放的超长区域名称用于验证窄屏换行而不是溢出布局"),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建区域" }).click();
  const areaDialog = page.getByRole("dialog", { name: "创建区域" });
  await areaDialog.getByLabel("区域代码").fill("quiet-zone");
  await areaDialog.getByLabel("区域显示名称").fill("静音训练区");
  await areaDialog.getByRole("button", { name: "创建区域" }).click();
  await expect(page.getByText("区域已由服务端确认创建")).toBeVisible();
  await expect(page.getByText("静音训练区")).toBeVisible();

  await page.getByRole("button", { name: "编辑座位 A-18" }).click();
  const seatDialog = page.getByRole("dialog", { name: "编辑座位 A-18" });
  await expect(seatDialog.getByLabel("座位编号")).toBeDisabled();
  await expect(seatDialog.getByLabel("座位生命周期")).toBeFocused();
  await expect(seatDialog.getByLabel("座位运营状态")).toBeDisabled();
  await seatDialog.getByLabel("座位生命周期").selectOption("inactive");
  await seatDialog.getByRole("button", { name: "保存座位" }).click();
  const dependencyDialog = page.getByRole("dialog", {
    name: "A-18 暂不能停用",
  });
  await expect(dependencyDialog.getByText("2 条有效预约")).toBeVisible();
  await expect(dependencyDialog.getByText("1 条未关闭报修")).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("manager creates a future price version and maintains only store-level product fields", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterManagerStoreConfiguration(page);

  await page.getByRole("tab", { name: /价格计划/u }).click();
  await expect(page.getByText("v1 · 当前")).toBeVisible();
  await page.getByRole("button", { name: "新建未来版本" }).click();
  const priceDialog = page.getByRole("dialog", {
    name: "新建未来价格版本",
  });
  await expect(priceDialog.getByLabel("价格适用区域")).toBeFocused();
  await priceDialog.getByLabel("工作日每半小时价格").fill("900");
  await priceDialog.getByLabel("周末每半小时价格").fill("1100");
  await expect(priceDialog.getByText("未发现重叠")).toBeVisible();
  await expect(
    priceDialog.getByText(/不会改写已有预约价格快照/u),
  ).toBeVisible();
  await priceDialog.getByRole("button", { name: "确认创建版本" }).click();
  await expect(page.getByText("未来价格版本已由服务端确认创建")).toBeVisible();
  await expect(page.getByText("v2 · 未来")).toBeVisible();
  await expect(page.getByText("¥9.00")).toBeVisible();

  await page.getByRole("tab", { name: /商品上架/u }).click();
  await page.getByRole("button", { name: "配置商品 栖光气泡水" }).click();
  const productDialog = page.getByRole("dialog", {
    name: "门店商品 · 栖光气泡水",
  });
  await expect(
    productDialog.locator('input[value="sparkling-water"]'),
  ).toBeDisabled();
  await productDialog.getByLabel("门店上架").uncheck();
  await productDialog.getByLabel("门店商品售价").fill("650");
  await productDialog.getByLabel("低库存预警阈值").fill("21");
  await productDialog.getByRole("button", { name: "保存门店配置" }).click();
  await expect(page.getByText("门店商品配置已由服务端确认保存")).toBeVisible();
  await expect(page.getByText("¥6.50")).toBeVisible();
  await expect(page.getByText("已下架", { exact: true })).toBeVisible();
  await expect(page.getByText("已触发预警")).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("manager sees current, per-day-set effective, and truly future business-hour rules after the 06:00 boundary", async ({
  page,
}) => {
  const boundaryConfiguration: ManagerStoreConfigurationResponse = {
    areas: [],
    businessHours: {
      baseline: {
        closesAt: "00:00",
        closesNextDay: true,
        display: "24 小时",
        isOpen24Hours: true,
        opensAt: "00:00",
      },
      current: {
        closesAt: "23:00",
        closesNextDay: false,
        display: "09:00–23:00",
        isOpen24Hours: false,
        opensAt: "09:00",
      },
      effective: [
        {
          businessHoursId: "00000000-0000-4000-8000-000000000121",
          closesAt: "02:00",
          closesNextDay: true,
          daySet: "weekends",
          effectiveFrom: "2026-08-09T22:00:00.000Z",
          isOpen24Hours: false,
          opensAt: "10:00",
        },
        {
          businessHoursId: "00000000-0000-4000-8000-000000000122",
          closesAt: "23:00",
          closesNextDay: false,
          daySet: "weekdays",
          effectiveFrom: "2026-08-10T22:00:00.000Z",
          isOpen24Hours: false,
          opensAt: "09:00",
        },
      ],
      scheduled: [
        {
          businessHoursId: "00000000-0000-4000-8000-000000000123",
          closesAt: "00:00",
          closesNextDay: true,
          daySet: "all",
          effectiveFrom: "2026-08-12T22:00:00.000Z",
          isOpen24Hours: true,
          opensAt: "00:00",
        },
      ],
    },
    currentTime: "2026-08-10T22:30:00.000Z",
    machineProfiles: [],
    pricePlans: [],
    products: [],
    seats: [],
    status: "ready",
    store: {
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      fictitiousCity: "栖光市（虚构）",
      fixed: true,
      introduction: "营业规则边界可见性回归使用的虚构演示门店。",
      seatCount: 0,
      storeId: "00000000-0000-4000-8000-000000000111",
      version: 4,
    },
  };
  await page.route("**/api/v1/manager/store-configuration", async (route) => {
    await route.fulfill({ json: boundaryConfiguration, status: 200 });
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterManagerStoreConfiguration(page);

  await expect(page.locator(".store-config-current-hours")).toContainText(
    "09:00–23:00",
  );
  const effective = page
    .locator(".store-config-scheduled-hours")
    .filter({ hasText: "默认回退与各适用日已生效版本" });
  await expect(effective).toContainText("默认回退");
  await expect(effective).toContainText("未命中适用日版本时使用");
  await expect(effective).toContainText("工作日");
  await expect(effective).toContainText("周末");
  const future = page
    .locator(".store-config-scheduled-hours")
    .filter({ hasText: "未来规则" });
  await expect(future).toContainText("每天");
  await expect(future.getByText(/2026年8月13日.*06:00 生效/u)).toHaveCount(1);

  await page.setViewportSize({ width: 1024, height: 768 });
  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("manager store configuration withholds success when the confirmed result cannot be reread", async ({
  page,
}) => {
  let commandConfirmed = false;
  await page.route("**/api/v1/manager/store-configuration**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname.endsWith("/commands")) {
      commandConfirmed = true;
      await route.fulfill({
        json: {
          action: "update-store-profile",
          objectId: "00000000-0000-4000-8000-000000000111",
          replayed: false,
          version: 2,
        },
        status: 200,
      });
      return;
    }
    if (request.method() === "GET" && commandConfirmed) {
      await route.fulfill({
        json: {
          error: {
            code: "STORE_CONFIGURATION_SERVICE_UNAVAILABLE",
            message: "最新配置暂时无法回读。",
            requestId: crypto.randomUUID(),
          },
        },
        status: 503,
      });
      return;
    }
    await route.fallback();
  });
  await enterManagerStoreConfiguration(page);

  await page.getByLabel("门店工作名称").fill("等待服务端回读的门店名称");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText(
      "服务端已确认写入，但最新配置回读失败；请刷新页面后再继续。",
    ),
  ).toBeVisible();
  await expect(page.getByText("门店展示资料已由服务端确认保存")).toHaveCount(0);
});

test("manager store configuration reuses the idempotency key after an unknown response", async ({
  page,
}) => {
  const attemptedKeys: string[] = [];
  await page.route(
    "**/api/v1/manager/store-configuration/commands",
    async (route) => {
      attemptedKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (attemptedKeys.length === 1) {
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    },
  );
  await enterManagerStoreConfiguration(page);

  await page.getByLabel("门店工作名称").fill("安全重试门店名称");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("提交结果暂时未知，请使用原提交标识安全重试。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("门店展示资料已由服务端确认保存")).toBeVisible();
  expect(attemptedKeys).toHaveLength(2);
  expect(attemptedKeys[0]).toBe(attemptedKeys[1]);
});

test("manager store configuration reuses the idempotency key after parsed 408 and 503 responses", async ({
  page,
}) => {
  const attemptedKeys: string[] = [];
  await page.route(
    "**/api/v1/manager/store-configuration/commands",
    async (route) => {
      attemptedKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (attemptedKeys.length <= 2) {
        await route.fulfill({
          json: {
            error: {
              code: "STORE_CONFIGURATION_SERVICE_UNAVAILABLE",
              message: "门店配置服务暂不可用，请稍后重试。",
              requestId: crypto.randomUUID(),
            },
          },
          status: attemptedKeys.length === 1 ? 408 : 503,
        });
        return;
      }
      await route.fallback();
    },
  );
  await enterManagerStoreConfiguration(page);

  await page.getByLabel("门店工作名称").fill("可解析未知结果重试门店名称");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("提交结果暂时未知，请使用原提交标识安全重试。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存资料" }).click();
  expect(attemptedKeys).toHaveLength(2);
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("门店展示资料已由服务端确认保存")).toBeVisible();
  expect(attemptedKeys).toHaveLength(3);
  expect(attemptedKeys[0]).toBe(attemptedKeys[1]);
  expect(attemptedKeys[1]).toBe(attemptedKeys[2]);
});

test("manager store configuration keeps each unresolved command idempotency key independently", async ({
  page,
}) => {
  const attempts: Array<{ body: string; key: string }> = [];
  await page.route(
    "**/api/v1/manager/store-configuration/commands",
    async (route) => {
      attempts.push({
        body: route.request().postData() ?? "",
        key: route.request().headers()["idempotency-key"] ?? "",
      });
      if (attempts.length === 1) {
        await route.fulfill({
          json: {
            error: {
              code: "STORE_CONFIGURATION_SERVICE_UNAVAILABLE",
              message: "门店配置服务暂不可用，请稍后重试。",
              requestId: crypto.randomUUID(),
            },
          },
          status: 503,
        });
        return;
      }
      if (attempts.length === 2) {
        await route.fulfill({
          json: {
            error: {
              code: "STORE_CONFIGURATION_INVALID_INPUT",
              message: "第二项配置未被服务端接受。",
              requestId: crypto.randomUUID(),
            },
          },
          status: 422,
        });
        return;
      }
      await route.fallback();
    },
  );
  await enterManagerStoreConfiguration(page);

  await page.getByLabel("门店工作名称").fill("第一项未知结果配置");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("提交结果暂时未知，请使用原提交标识安全重试。"),
  ).toBeVisible();

  await page.getByLabel("门店工作名称").fill("第二项确定失败配置");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("第二项配置未被服务端接受。")).toBeVisible();

  await page.getByLabel("门店工作名称").fill("第一项未知结果配置");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("门店展示资料已由服务端确认保存")).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(attempts[0]?.body).toBe(attempts[2]?.body);
  expect(attempts[0]?.key).toBe(attempts[2]?.key);
  expect(attempts[1]?.key).not.toBe(attempts[0]?.key);
});

test("staff reads inventory while manager stocktakes, receives and compensates with dedicated dialogs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "库存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "库存" })).toBeVisible();
  await expect(page.getByText("余额只读")).toBeVisible();
  await expect(page.getByRole("button", { name: "手工入库" })).toHaveCount(0);

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await expect(page.getByRole("heading", { name: "经营看板" })).toBeVisible();
  await page.getByRole("button", { name: "库存", exact: true }).click();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();

  const stocktakeTrigger = page.getByRole("button", { name: "盘点" });
  await stocktakeTrigger.click();
  await expect(page.getByLabel("库存项目", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(stocktakeTrigger).toBeFocused();
  await stocktakeTrigger.click();
  const stocktake = page.getByRole("dialog", { name: "创建库存盘点" });
  await expect(stocktake).toBeVisible();
  const stocktakeBox = await stocktake.boundingBox();
  expect(stocktakeBox?.width).toBe(560);
  expect(stocktakeBox?.height).toBe(542);
  await stocktake.getByLabel("实际数量").fill("10");
  await expect(stocktake.getByText(/差额.*\+1/u)).toBeVisible();
  await stocktake
    .getByLabel("盘点原因")
    .fill("闭店前例行盘点，现场数量已复核。");
  await stocktake.getByRole("button", { name: "提交盘点" }).click();
  await expect(page.getByText("盘点流水已创建")).toBeVisible();

  await page.getByRole("button", { name: "手工入库" }).click();
  const receipt = page.getByRole("dialog", { name: "创建手工入库" });
  await receipt.getByLabel("入库数量").fill("3");
  await receipt.getByLabel("入库原因").fill("门店补货到货，店长已复核数量。");
  await receipt.getByRole("button", { name: "确认入库" }).click();
  await expect(page.getByText("入库流水已创建")).toBeVisible();

  await page.getByRole("button", { name: "补偿流水" }).click();
  const compensation = page.getByRole("dialog", { name: "创建补偿流水" });
  await compensation.getByLabel("补偿差额").fill("-1");
  await compensation
    .getByLabel("补偿原因")
    .fill("原入库多计一件，使用新流水进行补偿。");
  await compensation.getByRole("button", { name: "创建补偿" }).click();
  await expect(page.getByText("补偿流水已创建")).toBeVisible();

  await page.getByRole("button", { name: "收起流水" }).click();
  await page.getByRole("button", { name: "查看全部流水" }).click();
  await expect(
    page.locator("#inventory-ledger-rows").getByText("原入库多计一件"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("repair spares, resolution, independent failure retry, and close remain state-specific", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "报修", exact: true }).click();
  await expect(page.getByText("处理中", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "领用备件" }).click();
  const claim = page.getByRole("dialog", { name: "领用维修备件" });
  await expect(claim.getByLabel("本店可用备件")).toHaveValue(
    "00000000-0000-4000-8000-000000000917",
  );
  await claim.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText(/领用 1 · 退回 0 ·\s*消耗 1/u)).toBeVisible();
  await expect(page.getByText(/业务发生.*入库记录/u).first()).toBeVisible();

  await page.getByRole("button", { name: "退回未用备件" }).click();
  const returned = page.getByRole("dialog", { name: "退回未使用备件" });
  await returned.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText(/领用 1 · 退回 1 ·\s*消耗 0/u)).toBeVisible();

  await page.getByRole("button", { name: "提交解决说明" }).click();
  const resolution = page.getByRole("dialog", { name: "提交解决说明" });
  await resolution.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("待验证", { exact: true }).last()).toBeVisible();
  await expect(
    page.getByText("已更换无品牌备用耳机并完成左右声道测试。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "验证成功并关闭" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await page.getByRole("button", { name: "报修", exact: true }).click();
  await page.getByRole("button", { name: "验证失败并退回" }).click();
  const failure = page.getByRole("dialog", { name: "验证失败并退回" });
  await failure.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("最近验证 · 失败")).toBeVisible();
  await expect(page.getByText("处理中", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "提交解决说明" }).click();
  await page
    .getByRole("dialog", { name: "提交解决说明" })
    .getByRole("button", { name: "确认提交" })
    .click();
  await page.getByRole("button", { name: "验证成功并关闭" }).click();
  const success = page.getByRole("dialog", { name: "验证成功并关闭" });
  await success.getByLabel("独立复测结论（成功可选）").fill("");
  await success.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("已关闭", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("最近验证 · 成功")).toBeVisible();
  await expect(page.getByText("正常（验证后已恢复）")).toBeVisible();
  await expect(page.getByRole("button", { name: "领用备件" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交解决说明" })).toHaveCount(
    0,
  );
});

test("shared shell exposes the signed persona, role, scope, lifecycle, and freshness", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);

  await expect(page.getByText("演示数据", { exact: true })).toBeVisible();
  await expect(
    page.getByText("周宁 · 虚构人物", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("店员｜棱镜旗舰店", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("沙箱到期", { exact: true })).toBeVisible();
  await expect(page.getByText("手动刷新", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "到店窗口" }).getByText("林澈 · 虚构人物"),
  ).toBeVisible();
  for (const nav of [
    "工作台",
    "预约",
    "商品订单",
    "报修",
    "库存",
    "班次与交接",
  ]) {
    await expect(
      page.getByRole("button", { name: nav, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: /林澈.*查看任务/u }).click();
  await expect(page.getByRole("button", { name: "办理到店" })).toBeVisible();
  await expect(page.getByText("不可变业务事件")).toBeVisible();

  const roleTrigger = page.getByRole("button", { name: "切换角色" });
  await roleTrigger.click();
  await expect(
    page.getByRole("heading", { name: "切换演示角色" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭角色切换" }),
  ).toBeFocused();
  for (const target of [
    "顾客 林澈 · 虚构人物 浏览三店 · 只管理自己的记录",
    "店员 周宁 · 虚构人物 棱镜旗舰店 当前角色",
    "店长 许知远 · 虚构人物 棱镜旗舰店",
    "总部运营 沈微 · 虚构人物 固定三店",
  ]) {
    await expect(page.getByRole("button", { name: target })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(roleTrigger).toBeFocused();
});

test("staff fulfills paid orders one observable stage at a time and safely retries cancellation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: "商品订单", exact: true }).click();

  await expect(page.getByRole("heading", { name: "商品订单" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "待制作 1" })).toBeVisible();
  await page.getByRole("tab", { name: "待制作 1" }).click();
  await expect(
    page.getByRole("button", { name: /林澈.*能量饮料.*已模拟支付/u }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "全部 2" }).click();
  await page
    .getByRole("button", { name: /林澈.*能量饮料.*已模拟支付/u })
    .click();
  await expect(
    page.getByRole("complementary", { name: "商品订单详情" }),
  ).toContainText("商品快照");
  await expect(page.getByRole("button", { name: "开始制作" })).toBeVisible();

  let failedPrimaryKey = "";
  const failPrimary = async (route: Route) => {
    failedPrimaryKey = route.request().headers()["idempotency-key"] ?? "";
    await route.fulfill({
      json: {
        error: {
          code: "STAFF_ORDER_SERVICE_UNAVAILABLE",
          message: "订单动作未能完成，原状态保持不变；可以安全重试。",
          requestId: "00000000-0000-4000-8000-000000000970",
        },
      },
      status: 503,
    });
  };
  await page.route("**/api/v1/staff/orders/**/commands", failPrimary);
  await page.getByRole("button", { name: "开始制作" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "商品订单详情" })
      .getByRole("alert"),
  ).toContainText("原状态保持不变");
  await page.unroute("**/api/v1/staff/orders/**/commands", failPrimary);

  const commandRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/staff/orders/") &&
      request.url().endsWith("/commands"),
  );
  await page.getByRole("button", { name: "开始制作" }).click();
  const retriedPrimary = await commandRequest;
  expect(retriedPrimary.headers()["idempotency-key"]).toBe(failedPrimaryKey);
  await expect(
    page.getByRole("button", { name: "正在提交开始制作" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "标记待取" })).toBeVisible();
  await page.getByRole("button", { name: "标记待取" }).click();
  await expect(page.getByRole("button", { name: "完成订单" })).toBeVisible();
  const orderDetail = page.getByRole("complementary", {
    name: "商品订单详情",
  });
  await expect(orderDetail.getByText("已开始制作")).toBeVisible();
  await expect(orderDetail.getByText("已标记待取")).toBeVisible();
  await page.getByRole("button", { name: "完成订单" }).click();
  await expect(
    page.getByRole("complementary", { name: "商品订单详情" }),
  ).toContainText("已完成");
  await expect(page.getByRole("main").getByText("成长值 +11")).toBeVisible();

  await page.getByRole("button", { name: /顾辰.*烤肠.*待取/u }).click();
  await expect(page.getByText("正在读取服务端详情…")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始制作" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "完成订单" })).toBeVisible();
  await page.getByRole("button", { name: "取消订单" }).click();
  await expect(
    page.getByRole("dialog", { name: "取消商品订单" }),
  ).toBeVisible();
  await expect(page.getByLabel("取消原因")).toBeFocused();
  await expect(page.getByRole("button", { name: "确认取消" })).toBeDisabled();
  await page.getByLabel("取消原因").fill("顾客临时改变取货计划");

  let failedCancellationKey = "";
  const failCancellation = async (route: Route) => {
    failedCancellationKey = route.request().headers()["idempotency-key"] ?? "";
    await route.fulfill({
      json: {
        error: {
          code: "STAFF_ORDER_SERVICE_UNAVAILABLE",
          message: "订单动作未能完成，原状态保持不变；可以安全重试。",
          requestId: "00000000-0000-4000-8000-000000000971",
        },
      },
      status: 503,
    });
  };
  await page.route("**/api/v1/staff/orders/**/commands", failCancellation);
  await page.getByRole("button", { name: "确认取消" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "取消商品订单" });
  await expect(cancelDialog.getByRole("alert")).toContainText("原状态保持不变");
  await expect(cancelDialog).toBeVisible();
  await page.unroute("**/api/v1/staff/orders/**/commands", failCancellation);
  const cancellationRetry = page.waitForRequest(
    (request) =>
      request.url().endsWith("/commands") &&
      request.postDataJSON().action === "cancel",
  );
  await page.getByRole("button", { name: "重试取消" }).click();
  expect((await cancellationRetry).headers()["idempotency-key"]).toBe(
    failedCancellationKey,
  );
  await expect(
    page.getByRole("main").getByText("模拟退款 ¥15.00"),
  ).toBeVisible();
  await expect(page.getByRole("main").getByText("库存记为损耗")).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  const widths = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(widths.bodyScrollWidth).toBe(widths.bodyClientWidth);
});

test("narrow workbench collapses the inspector without clipping the primary surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 883, height: 866 });

  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "展开当前对象" }),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".role-workbench-main");
    const primary = document.querySelector<HTMLElement>(
      ".role-queue-row.is-primary",
    );
    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      primaryClientWidth: primary?.clientWidth ?? 0,
      primaryScrollWidth: primary?.scrollWidth ?? 0,
      primaryWidth: primary?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(layout.bodyScrollWidth).toBe(layout.bodyClientWidth);
  expect(layout.primaryScrollWidth).toBe(layout.primaryClientWidth);
  expect(layout.mainWidth).toBeGreaterThan(layout.primaryWidth);

  await page.setViewportSize({ width: 452, height: 413 });
  const compactLayout = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".role-page-title h1");
    const expand = document.querySelector<HTMLElement>(
      ".role-page-tools > button",
    );
    const primary = document.querySelector<HTMLElement>(
      ".role-queue-row.is-primary",
    );

    return {
      expandHeight: expand?.getBoundingClientRect().height ?? 0,
      primaryClientWidth: primary?.clientWidth ?? 0,
      primaryHeight: primary?.getBoundingClientRect().height ?? 0,
      primaryScrollWidth: primary?.scrollWidth ?? 0,
      titleHeight: title?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(compactLayout.primaryScrollWidth).toBe(
    compactLayout.primaryClientWidth,
  );
  expect(compactLayout.primaryHeight).toBeGreaterThan(130);
  expect(compactLayout.primaryHeight).toBeLessThan(180);
  expect(compactLayout.expandHeight).toBeLessThan(50);
  expect(compactLayout.titleHeight).toBeLessThan(40);

  await page.setViewportSize({ width: 366, height: 866 });
  await page.getByRole("button", { name: "展开当前对象" }).click();
  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
});

test("staff queue drilldown preserves its authoritative reservation filter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);

  await expect(page.getByRole("region", { name: "到店窗口" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "已到店待开始" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "使用中" })).toBeVisible();
  await expect(page.getByRole("region", { name: "异常预约" })).toBeVisible();
  await page
    .getByRole("region", { name: "到店窗口" })
    .getByRole("button", { name: /查看全部/u })
    .click();

  await expect(
    page.getByRole("heading", { name: "预约", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "按时间筛选" })).toHaveValue(
    "arrival-window",
  );
  await expect(page.getByRole("button", { name: /林澈.*A-18/u })).toBeVisible();
  await page
    .getByRole("combobox", { name: "按状态筛选" })
    .selectOption("in-use");
  await page.getByRole("combobox", { name: "按时间筛选" }).selectOption("all");
  await expect(page.getByRole("button", { name: /周屿.*C-01/u })).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "当前选中对象" })
      .getByRole("heading", { name: /周屿.*使用中/u }),
  ).toBeVisible();
});

test("staff commands confirm on the server and require a privacy-safe reason", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: /林澈.*查看任务/u }).click();
  await page.getByRole("button", { name: "办理到店" }).click();
  const arrivalDialog = page.getByRole("dialog", { name: "确认办理到店" });
  await expect(arrivalDialog).toBeVisible();
  await expect(
    arrivalDialog.getByText("服务端原子校验当前状态、时间窗口和门店范围", {
      exact: false,
    }),
  ).toBeVisible();
  await arrivalDialog.getByRole("button", { name: "确认办理到店" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "当前选中对象" })
      .getByText("已到店", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "取消预约" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "确认取消预约" });
  const confirmCancel = cancelDialog.getByRole("button", {
    name: "确认取消预约",
  });
  await expect(cancelDialog.getByText(/请勿填写真实个人信息/u)).toBeVisible();
  await expect(confirmCancel).toBeDisabled();
  await cancelDialog
    .getByRole("textbox", { name: "办理原因" })
    .fill("顾客临时改变行程");
  await expect(confirmCancel).toBeEnabled();
  await confirmCancel.click();
  await expect(
    page
      .getByRole("complementary", { name: "当前选中对象" })
      .getByText("已取消", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("预约已进入终态，不再提供办理动作。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "取消预约" })).toHaveCount(0);
});

test("early completion leaves no redundant action and does not overflow at 1024", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: /周屿.*C-01/u }).click();
  await page.getByRole("button", { name: "提前结束" }).click();
  const dialog = page.getByRole("dialog", { name: "确认提前结束" });
  await dialog
    .getByRole("textbox", { name: "办理原因" })
    .fill("顾客主动提前结束");
  await dialog.getByRole("button", { name: "确认提前结束" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "当前选中对象" })
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "提前结束" })).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    client: document.body.clientWidth,
    scroll: document.body.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
});

test("narrow role switch dialog follows the single-column design", async ({
  page,
}) => {
  await page.setViewportSize({ width: 407, height: 866 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: /打开角色切换/u }).click();

  await expect(
    page.getByRole("heading", { name: "切换演示角色" }),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(".role-switch-dialog");
    const grid = document.querySelector<HTMLElement>(".shell-role-grid");
    const cards = Array.from(
      grid?.querySelectorAll<HTMLElement>("button") ?? [],
    );
    const dialogRect = dialog?.getBoundingClientRect();

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cardHeights: cards.map((card) => card.getBoundingClientRect().height),
      cardWidths: cards.map((card) => card.getBoundingClientRect().width),
      cardXs: cards.map((card) => card.getBoundingClientRect().x),
      dialogClientHeight: dialog?.clientHeight ?? 0,
      dialogHeight: dialogRect?.height ?? 0,
      dialogWidth: dialogRect?.width ?? 0,
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
    };
  });

  expect(layout.bodyScrollWidth).toBe(layout.bodyClientWidth);
  expect(layout.dialogWidth).toBeGreaterThan(370);
  expect(layout.dialogWidth).toBeLessThanOrEqual(383);
  expect(layout.dialogHeight).toBeLessThanOrEqual(842);
  expect(layout.dialogClientHeight).toBeGreaterThan(650);
  expect(layout.cardWidths).toHaveLength(4);
  expect(new Set(layout.cardXs).size).toBe(1);
  expect(layout.cardWidths.every((width) => width > 330)).toBe(true);
  expect(layout.cardHeights.every((height) => height >= 110)).toBe(true);
  expect(layout.cardHeights.every((height) => height < 130)).toBe(true);
  expect(layout.gridColumns.split(" ")).toHaveLength(1);

  await page.getByRole("button", { name: "关闭角色切换" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("business-time tool previews impacts and commits the clock atomically", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("button", {
      name: /打开业务时间工具，当前 19:30/u,
    }),
  ).toBeVisible();
  const otherTabFilter = otherTab.getByRole("searchbox", {
    name: "筛选当前队列",
  });
  await otherTabFilter.fill("林澈");

  const timeTrigger = page.getByRole("button", {
    name: /打开业务时间工具/u,
  });
  await expect(timeTrigger).toHaveAttribute("aria-label", /当前 19:30/u);
  await timeTrigger.click();
  await expect(
    page.getByRole("heading", { name: "选择业务时间推进方式" }),
  ).toBeVisible();
  await expect(
    page.getByText("真实服务器时间、TTL、验证码", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: /向前推进 30 分钟/u }).click();
  await expect(page.getByText(/19:30.*20:00/u).first()).toBeVisible();
  await expect(page.getByText("待支付订单过期")).toBeVisible();
  await expect(page.getByText("2 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看推进影响" }).click();

  await expect(
    page.getByRole("heading", { name: "确认业务时间与到期影响" }),
  ).toBeVisible();
  await expect(page.getByText("真实服务器时间保持不变。")).toBeVisible();
  await page.getByRole("button", { name: "确认并原子推进" }).click();

  await expect(
    page.getByRole("heading", { name: "业务时间已完整推进" }),
  ).toBeVisible();
  await expect(page.getByText("已处理到期对象")).toBeVisible();
  await page.getByRole("button", { name: "返回当前角色" }).click();
  await expect(
    page.getByRole("button", { name: /打开业务时间工具，当前 20:00/u }),
  ).toBeVisible();
  await expect(
    otherTab.getByRole("button", {
      name: /打开业务时间工具，当前 20:00/u,
    }),
  ).toBeVisible();
  await expect(otherTabFilter).toHaveValue("林澈");
  await expect(timeTrigger).toBeFocused();
});

test("failed time transaction keeps the old clock and safely retries one request", async ({
  page,
}) => {
  await enterStaffShell(page);
  let firstAttempt = true;
  await page.route("**/api/v1/demo/time/advance", async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await route.fallback({
        headers: {
          ...route.request().headers(),
          "x-test-advance-failed": "1",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page
    .getByRole("button", { name: /打开业务时间工具，当前 19:30/u })
    .click();
  await page.getByRole("button", { name: /向前推进 30 分钟/u }).click();
  await page.getByRole("button", { name: "查看推进影响" }).click();
  await page.getByRole("button", { name: "确认并原子推进" }).click();

  await expect(
    page.getByText("时钟和业务状态均未改变；可以安全重试。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用同一请求安全重试" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "使用同一请求安全重试" }).click();
  await expect(
    page.getByRole("heading", { name: "业务时间已完整推进" }),
  ).toBeVisible();
});

test("business-time tool explains the exact 24-hour cap", async ({ page }) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/time", async (route) => {
    await route.fulfill({
      json: {
        status: "ready",
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds: 86_400_000,
          currentTime: "2026-08-10T11:30:00.000Z",
          remainingAdvanceMilliseconds: 0,
          timeZone: "Asia/Shanghai",
        },
        halfHour: { afterTime: null, impacts: [] },
        nextEvent: null,
      },
      status: 200,
    });
  });

  await page.getByRole("button", { name: /打开业务时间工具/u }).click();
  await expect(
    page.getByRole("heading", { name: "已达到本沙箱的推进上限" }),
  ).toBeVisible();
  await expect(
    page.getByText("累计业务时间最多可向前推进 24 小时"),
  ).toBeVisible();
  await expect(
    page.getByText("如需从标准故事起点重新演示，请关闭后使用顶栏“重置沙箱”。"),
  ).toBeVisible();
});

test("sandbox reset requires two confirmations and invalidates old tabs", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("heading", { name: "现场脉冲" }),
  ).toBeVisible();

  const resetTrigger = page.getByRole("button", {
    name: "重置为全新标准沙箱",
  });
  await resetTrigger.click();
  await expect(
    page.getByRole("heading", {
      name: "重置会替换四个角色的整条演示故事",
    }),
  ).toBeVisible();
  for (const role of ["顾客", "店员", "店长", "总部运营"]) {
    await expect(page.getByText(role, { exact: true }).last()).toBeVisible();
  }
  await page.getByRole("button", { name: "继续二次确认" }).click();
  const confirmation = page.getByRole("checkbox", {
    name: /我了解顾客、店员、店长与总部运营/u,
  });
  await expect(
    page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }),
  ).toBeDisabled();
  await confirmation.check();
  await page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }).click();

  await expect(
    page.getByRole("heading", { name: "全新标准沙箱已就绪" }),
  ).toBeVisible();
  const staleBlock = otherTab.getByRole("alertdialog", {
    name: "当前标签的旧沙箱已失效",
  });
  await expect(staleBlock).toBeVisible();
  await expect(
    staleBlock.getByText("旧沙箱中的四角色对象和写操作均已停止"),
  ).toBeVisible();
  await staleBlock.getByRole("button", { name: "进入全新标准沙箱" }).click();
  await expect(
    otherTab.getByRole("button", {
      name: "林澈 顾客 浏览三店 · 只管理自己的记录，打开角色切换",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "回到主演示起点" }).click();
  await expect(
    page.getByRole("button", {
      name: "林澈 顾客 浏览三店 · 只管理自己的记录，打开角色切换",
    }),
  ).toBeVisible();
  await expect(resetTrigger).toBeFocused();
});

test("failed sandbox reset preserves the old story and retries safely", async ({
  page,
}) => {
  await enterStaffShell(page);
  let firstAttempt = true;
  await page.route("**/api/v1/demo/reset", async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await route.fallback({
        headers: {
          ...route.request().headers(),
          "x-test-reset-failed": "1",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "重置为全新标准沙箱" }).click();
  await page.getByRole("button", { name: "继续二次确认" }).click();
  await page
    .getByRole("checkbox", {
      name: /我了解顾客、店员、店长与总部运营/u,
    })
    .check();
  await page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }).click();

  await expect(
    page.getByText("全新沙箱创建失败，当前沙箱仍完整保留"),
  ).toBeVisible();
  await expect(
    page.locator('button[aria-label="周宁 店员 棱镜旗舰店，打开角色切换"]'),
  ).toBeAttached();
  await page.getByRole("button", { name: "安全重试创建新沙箱" }).click();
  await expect(
    page.getByRole("heading", { name: "全新标准沙箱已就绪" }),
  ).toBeVisible();
});

test("dirty queue input requires confirmation and keyboard switching rotates the visible context", async ({
  page,
}) => {
  await enterStaffShell(page);
  const queueFilter = page.getByRole("searchbox", { name: "筛选当前队列" });
  await queueFilter.fill("林澈");
  await page.getByRole("button", { name: "切换角色" }).click();
  const managerTarget = page.getByRole("button", {
    name: "店长 许知远 · 虚构人物 棱镜旗舰店",
  });
  await managerTarget.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "放弃未提交输入并切换？" }),
  ).toBeVisible();
  await expect(
    page.getByText("继续切换会放弃当前队列或预约筛选", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回继续编辑" }).click();
  await expect(managerTarget).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "放弃输入并切换到店长" }).click();

  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("店长｜棱镜旗舰店", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "经营看板" })).toBeVisible();
  await expect(queueFilter).toHaveCount(0);
});

test("applied reservation filters are protected before a role switch", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.getByRole("button", { name: "预约", exact: true }).click();
  await page
    .getByRole("combobox", { name: "按状态筛选" })
    .selectOption("in-use");
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", {
      name: "店长 许知远 · 虚构人物 棱镜旗舰店",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "放弃未提交输入并切换？" }),
  ).toBeVisible();
  await expect(
    page.getByText("继续切换会放弃当前队列或预约筛选", {
      exact: false,
    }),
  ).toBeVisible();
});

test("a role switch in another tab immediately blocks the stale shell until refresh", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("heading", { name: "现场脉冲" }),
  ).toBeVisible();

  await otherTab.getByRole("button", { name: "切换角色" }).click();
  await otherTab
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    otherTab.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await expect(
    staleBlock.getByText("旧角色写操作已停止，不能使用缓存继续提交。"),
  ).toBeVisible();
  const staleRefresh = staleBlock.getByRole("button", {
    name: "刷新到当前角色",
  });
  await expect(staleRefresh).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(staleRefresh).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(staleRefresh).toBeFocused();
  await staleRefresh.click();
  await expect(staleBlock).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "切换角色" })).toBeFocused();

  await otherTab.getByRole("button", { name: "切换角色" }).click();
  await otherTab
    .getByRole("button", { name: "总部运营 沈微 · 虚构人物 固定三店" })
    .click();
  await expect(
    otherTab.getByRole("button", {
      name: "沈微 总部运营 固定三店，打开角色切换",
    }),
  ).toBeVisible();
});

test("a lost switch response blocks the shell and recovers the server-current role", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-response-lost": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(staleBlock).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
});

test("an uncertain switch response uses the same blocking recovery path", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-result-unknown": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
});

test("an unavailable sandbox returns the shell to the public role entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-unavailable": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session returns the shell to the public role entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session discovered by manual GET refresh returns to the public entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });

  await page.getByRole("button", { name: "手动刷新角色上下文" }).click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session discovered during stale recovery returns to the public entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/refresh", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });
  await page.evaluate(() => {
    const channel = new BroadcastChannel("jingshu-role-context-v1");
    channel.postMessage({ contextVersion: 2 });
    channel.close();
  });

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("1024 layout collapses navigation without hiding the current role or primary work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  const sidebar = page.getByTestId("role-sidebar");
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(
    page.getByText("周宁 · 虚构人物", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换角色" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /折叠导航|展开导航/u }),
  ).toBeHidden();
});
