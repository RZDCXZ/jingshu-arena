import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import type {
  CustomerReservationStatus,
  HandoverCommandResponse,
  ManagerHandoverExceptionsResponse,
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
              buildHandover({
                confirmed: false,
                id: incomingHandoverId,
                note: "晚高峰到店窗口集中。",
                submitter: "赵一航",
              }),
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

  await page.getByRole("button", { name: "本人班次" }).click();
  await page.getByRole("button", { name: "手动签退" }).click();
  await expect(page.getByText("当前没有可执行动作")).toBeVisible();

  await page.getByRole("button", { name: "交接班" }).click();
  await page.getByRole("button", { name: "确认承接" }).click();
  await expect(page.getByText("当前没有待本人确认的同店交接。")).toBeVisible();
  await expect(
    page.getByText("接班确认已记录，业务时间与真实服务器时间均可追溯。"),
  ).toBeVisible();
});

test("manager reads three store-scoped handover exception kinds without edit controls", async ({
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
    page.getByRole("heading", { name: "交接异常与冻结快照" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^逾期未提交/u }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^迟交/u })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^长期未确认/u }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^迟交/u }).click();
  await expect(page.getByText("A-18 报修待分派。")).toBeVisible();
  await expect(page.getByText("业务发生", { exact: true })).toBeVisible();
  await expect(page.getByText("真实服务器记录", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.body.clientWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
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
