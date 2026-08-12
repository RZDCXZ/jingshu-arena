import type { PublicRole } from "@jingshu/contracts";

export const WEB_QUERY_ORDER = [
  "q",
  "sort",
  "direction",
  "range",
  "from",
  "to",
  "status",
  "time",
  "anomaly",
  "area",
  "machine",
  "type",
  "refunds",
  "kind",
  "alert",
  "metric",
  "store",
  "persona",
  "role",
  "action",
  "object",
  "result",
] as const;

export type WebQueryName = (typeof WEB_QUERY_ORDER)[number];

export interface WebRouteSpec {
  readonly heading: string;
  readonly id: string;
  readonly kind: "detail" | "flow-step" | "page" | "parent" | "root" | "tab";
  readonly queryOrder: readonly WebQueryName[];
  readonly replaceWith?: {
    readonly params?: Readonly<Record<string, string>>;
    readonly routeId: string;
  };
  readonly role: PublicRole | null;
  readonly template: string;
  readonly title: string;
}

const noQuery = [] as const;
const searchable = ["q", "sort", "direction"] as const;
const reservationFilters = [
  "q",
  "sort",
  "direction",
  "status",
  "time",
  "anomaly",
  "area",
  "machine",
] as const;
const inventoryFilters = ["q", "sort", "direction", "kind", "alert"] as const;
const dashboardFilters = ["range", "from", "to", "metric"] as const;
const auditFilters = [
  "q",
  "sort",
  "direction",
  "range",
  "from",
  "to",
  "persona",
  "role",
  "action",
  "object",
  "result",
] as const;

function route(
  id: string,
  template: string,
  role: PublicRole | null,
  kind: WebRouteSpec["kind"],
  heading: string,
  queryOrder: readonly WebQueryName[] = noQuery,
  replaceWith?: WebRouteSpec["replaceWith"],
): WebRouteSpec {
  return {
    heading,
    id,
    kind,
    queryOrder,
    ...(replaceWith ? { replaceWith } : {}),
    role,
    template,
    title: `${heading}｜竞枢`,
  };
}

export const WEB_ROUTE_MANIFEST: readonly WebRouteSpec[] = [
  route("public-root", "/", null, "root", "竞枢公开演示入口"),

  route(
    "customer-root",
    "/customer",
    "customer",
    "parent",
    "顾客入口",
    noQuery,
    {
      routeId: "customer-reservations",
    },
  ),
  route("staff-root", "/staff", "staff", "parent", "店员入口", noQuery, {
    routeId: "staff-workbench",
  }),
  route("manager-root", "/manager", "manager", "parent", "店长入口", noQuery, {
    routeId: "manager-dashboard",
  }),
  route("hq-root", "/hq", "hq", "parent", "总部运营入口", noQuery, {
    routeId: "hq-dashboard",
  }),

  route(
    "customer-journeys-root",
    "/customer/journeys",
    "customer",
    "parent",
    "统一行程",
    ["type", "refunds"],
    { routeId: "customer-journeys-current" },
  ),
  route(
    "customer-coupons-root",
    "/customer/membership/coupons",
    "customer",
    "parent",
    "体验券",
    noQuery,
    { routeId: "customer-coupons-available" },
  ),
  route(
    "staff-orders-root",
    "/staff/orders",
    "staff",
    "parent",
    "商品订单",
    searchable,
    {
      routeId: "staff-orders-all",
    },
  ),
  route(
    "staff-shifts-root",
    "/staff/shifts",
    "staff",
    "parent",
    "班次与交接",
    noQuery,
    {
      routeId: "staff-shifts-attendance",
    },
  ),
  route(
    "manager-live-ops-root",
    "/manager/live-ops",
    "manager",
    "parent",
    "现场运营",
    noQuery,
    { routeId: "manager-live-ops-workbench" },
  ),
  route(
    "manager-configuration-root",
    "/manager/configuration",
    "manager",
    "parent",
    "门店配置",
    noQuery,
    { routeId: "manager-configuration-profile" },
  ),
  route(
    "manager-people-root",
    "/manager/people",
    "manager",
    "parent",
    "员工与排班",
    noQuery,
    {
      routeId: "manager-people-employees",
    },
  ),
  route(
    "hq-catalogs-root",
    "/hq/catalogs",
    "hq",
    "parent",
    "连锁目录",
    searchable,
    {
      routeId: "hq-catalogs-products",
    },
  ),
  route("hq-stores-root", "/hq/stores", "hq", "parent", "门店配置", noQuery, {
    params: { storeCode: "prism-flagship" },
    routeId: "hq-store-profile",
  }),
  route(
    "hq-store-root",
    "/hq/stores/:storeCode",
    "hq",
    "parent",
    "门店配置",
    noQuery,
    { routeId: "hq-store-profile" },
  ),

  route(
    "customer-reservation-order-confirm",
    "/customer/reservations/:reservationId/orders/new/confirm",
    "customer",
    "flow-step",
    "确认商品订单",
  ),
  route(
    "customer-reservation-order-new",
    "/customer/reservations/:reservationId/orders/new",
    "customer",
    "flow-step",
    "选择商品",
  ),
  route(
    "customer-reservation-repair-new",
    "/customer/reservations/:reservationId/repairs/new",
    "customer",
    "flow-step",
    "提交报修",
  ),
  route(
    "customer-reservation-payment",
    "/customer/reservations/:reservationId/payment",
    "customer",
    "detail",
    "预约模拟支付",
  ),
  route(
    "customer-reservation-detail",
    "/customer/reservations/:reservationId",
    "customer",
    "detail",
    "预约详情",
  ),
  route(
    "customer-reservation-confirm",
    "/customer/reservations/new/confirm",
    "customer",
    "flow-step",
    "确认预约",
  ),
  route(
    "customer-reservation-seats",
    "/customer/reservations/new/seats",
    "customer",
    "flow-step",
    "选择座位",
  ),
  route(
    "customer-reservations",
    "/customer/reservations",
    "customer",
    "page",
    "预约",
    ["q", "sort", "direction", "area", "machine"],
  ),
  route("customer-stores", "/customer/stores", "customer", "page", "门店", [
    "q",
    "sort",
    "direction",
    "area",
    "machine",
  ]),
  ...(["current", "future", "history"] as const).map((tab) =>
    route(
      `customer-journeys-${tab}`,
      `/customer/journeys/${tab}`,
      "customer",
      "tab",
      tab === "current"
        ? "当前行程"
        : tab === "future"
          ? "未来行程"
          : "历史行程",
      ["type", "refunds"],
    ),
  ),
  ...(["available", "reserved", "redeemed", "expired"] as const).map((tab) =>
    route(
      `customer-coupons-${tab}`,
      `/customer/membership/coupons/${tab}`,
      "customer",
      "tab",
      tab === "available"
        ? "可用体验券"
        : tab === "reserved"
          ? "占用中体验券"
          : tab === "redeemed"
            ? "已使用体验券"
            : "已过期体验券",
    ),
  ),
  route(
    "customer-order-payment",
    "/customer/orders/:orderId/payment",
    "customer",
    "detail",
    "商品订单模拟支付",
  ),
  route(
    "customer-order-detail",
    "/customer/orders/:orderId",
    "customer",
    "detail",
    "商品订单详情",
  ),
  route(
    "customer-repair-detail",
    "/customer/repairs/:repairId",
    "customer",
    "detail",
    "报修详情",
  ),

  route("staff-workbench", "/staff/workbench", "staff", "page", "现场脉冲"),
  route(
    "staff-reservations",
    "/staff/reservations",
    "staff",
    "page",
    "预约",
    reservationFilters,
  ),
  route(
    "staff-reservation-detail",
    "/staff/reservations/:reservationId",
    "staff",
    "detail",
    "预约详情",
  ),
  ...(
    [
      "all",
      "simulated-paid",
      "preparing",
      "ready-for-pickup",
      "exception",
    ] as const
  ).map((tab) =>
    route(
      `staff-orders-${tab}`,
      `/staff/orders/${tab}`,
      "staff",
      "tab",
      tab === "all"
        ? "全部商品订单"
        : tab === "simulated-paid"
          ? "待制作商品订单"
          : tab === "preparing"
            ? "制作中商品订单"
            : tab === "ready-for-pickup"
              ? "待取商品订单"
              : "异常商品订单",
      searchable,
    ),
  ),
  route(
    "staff-order-detail",
    "/staff/orders/:orderId",
    "staff",
    "detail",
    "商品订单详情",
  ),
  route("staff-repairs", "/staff/repairs", "staff", "page", "报修", [
    "q",
    "sort",
    "direction",
    "status",
  ]),
  route(
    "staff-repair-detail",
    "/staff/repairs/:repairId",
    "staff",
    "detail",
    "报修详情",
  ),
  route(
    "staff-inventory",
    "/staff/inventory",
    "staff",
    "page",
    "库存",
    inventoryFilters,
  ),
  route(
    "staff-shifts-attendance",
    "/staff/shifts/attendance",
    "staff",
    "tab",
    "本人班次与考勤",
  ),
  route(
    "staff-shifts-handover",
    "/staff/shifts/handover",
    "staff",
    "tab",
    "交接班",
  ),

  route(
    "manager-dashboard",
    "/manager/dashboard",
    "manager",
    "page",
    "经营看板",
    dashboardFilters,
  ),
  route(
    "manager-live-ops-workbench",
    "/manager/live-ops/workbench",
    "manager",
    "tab",
    "现场工作台",
  ),
  route(
    "manager-live-ops-reservations",
    "/manager/live-ops/reservations",
    "manager",
    "tab",
    "现场预约",
    reservationFilters,
  ),
  route(
    "manager-live-ops-reservation-detail",
    "/manager/live-ops/reservations/:reservationId",
    "manager",
    "detail",
    "现场预约详情",
  ),
  route("manager-repairs", "/manager/repairs", "manager", "page", "报修", [
    "q",
    "sort",
    "direction",
    "status",
  ]),
  route(
    "manager-repair-detail",
    "/manager/repairs/:repairId",
    "manager",
    "detail",
    "报修详情",
  ),
  route(
    "manager-inventory",
    "/manager/inventory",
    "manager",
    "page",
    "库存",
    inventoryFilters,
  ),
  route(
    "manager-configuration-profile",
    "/manager/configuration/profile",
    "manager",
    "tab",
    "门店资料",
  ),
  route(
    "manager-configuration-seats",
    "/manager/configuration/seats",
    "manager",
    "tab",
    "区域与座位",
    ["q", "sort", "direction", "area", "machine"],
  ),
  route(
    "manager-configuration-pricing",
    "/manager/configuration/pricing",
    "manager",
    "tab",
    "价格计划",
    ["q", "sort", "direction", "area", "machine"],
  ),
  route(
    "manager-configuration-products",
    "/manager/configuration/products",
    "manager",
    "tab",
    "门店商品",
    inventoryFilters,
  ),
  route(
    "manager-people-employees",
    "/manager/people/employees",
    "manager",
    "tab",
    "员工",
    searchable,
  ),
  route(
    "manager-people-schedule",
    "/manager/people/schedule",
    "manager",
    "tab",
    "排班",
    searchable,
  ),
  route(
    "manager-people-attendance",
    "/manager/people/attendance",
    "manager",
    "tab",
    "考勤与交接",
    searchable,
  ),
  route(
    "manager-audit",
    "/manager/audit",
    "manager",
    "page",
    "审计与导出",
    auditFilters,
  ),
  route(
    "manager-audit-detail",
    "/manager/audit/events/:auditEventId",
    "manager",
    "detail",
    "审计事件详情",
  ),

  route("hq-dashboard", "/hq/dashboard", "hq", "page", "连锁看板", [
    ...dashboardFilters,
    "store",
  ]),
  route("hq-comparison", "/hq/comparison", "hq", "page", "门店比较", [
    ...dashboardFilters,
    "store",
  ]),
  route(
    "hq-catalogs-products",
    "/hq/catalogs/products",
    "hq",
    "tab",
    "连锁商品资料",
    searchable,
  ),
  route(
    "hq-catalogs-machines",
    "/hq/catalogs/machines",
    "hq",
    "tab",
    "机型档案",
    searchable,
  ),
  route(
    "hq-store-profile",
    "/hq/stores/:storeCode/profile",
    "hq",
    "tab",
    "门店资料",
  ),
  route(
    "hq-store-seats",
    "/hq/stores/:storeCode/seats",
    "hq",
    "tab",
    "区域与座位",
    ["q", "sort", "direction", "area", "machine"],
  ),
  route(
    "hq-store-pricing",
    "/hq/stores/:storeCode/pricing",
    "hq",
    "tab",
    "价格计划",
    ["q", "sort", "direction", "area", "machine"],
  ),
  route(
    "hq-store-products",
    "/hq/stores/:storeCode/products",
    "hq",
    "tab",
    "门店商品",
    inventoryFilters,
  ),
  route("hq-people", "/hq/people", "hq", "page", "人员与排班", [
    "q",
    "sort",
    "direction",
    "store",
  ]),
  route("hq-audit", "/hq/audit", "hq", "page", "审计与导出", [
    "q",
    "sort",
    "direction",
    "range",
    "from",
    "to",
    "store",
    "persona",
    "role",
    "action",
    "object",
    "result",
  ]),
  route(
    "hq-audit-detail",
    "/hq/audit/events/:auditEventId",
    "hq",
    "detail",
    "审计事件详情",
  ),
] as const;

const routesById = new Map(WEB_ROUTE_MANIFEST.map((spec) => [spec.id, spec]));

function routeSpec(routeId: string) {
  const spec = routesById.get(routeId);
  if (!spec) throw new Error(`Unknown Web route: ${routeId}`);
  return spec;
}

function templateSegments(template: string) {
  return template === "/" ? [] : template.slice(1).split("/");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function matchPathname(spec: WebRouteSpec, pathname: string) {
  const inputSegments =
    pathname === "/" ? [] : pathname.replace(/^\/+|\/+$/gu, "").split("/");
  const expectedSegments = templateSegments(spec.template);
  if (inputSegments.length !== expectedSegments.length) return null;

  const params: Record<string, string> = {};
  for (const [index, expected] of expectedSegments.entries()) {
    const actual = inputSegments[index];
    if (!actual) return null;
    if (expected.startsWith(":")) {
      const decoded = safeDecode(actual);
      if (!decoded) return null;
      params[expected.slice(1)] = decoded;
    } else if (actual.toLocaleLowerCase("en-US") !== expected) {
      return null;
    }
  }
  return params;
}

function normalizedQuery(spec: WebRouteSpec, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const name of spec.queryOrder) {
    const values = input.getAll(name);
    const value = values.at(-1);
    if (value) query.set(name, value);
  }
  return query;
}

export function buildWebPath(
  routeId: string,
  params: Readonly<Record<string, string>> = {},
  query?: URLSearchParams | Readonly<Record<string, string | null | undefined>>,
) {
  const spec = routeSpec(routeId);
  const pathname = templateSegments(spec.template)
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const name = segment.slice(1);
      const value = params[name];
      if (!value) throw new Error(`Missing Web route parameter: ${name}`);
      return encodeURIComponent(value);
    })
    .join("/");
  const inputQuery =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(
          Object.entries(query ?? {}).flatMap(([name, value]) =>
            value === null || value === undefined ? [] : [[name, value]],
          ),
        );
  const search = normalizedQuery(spec, inputQuery).toString();
  return `${pathname ? `/${pathname}` : "/"}${search ? `?${search}` : ""}`;
}

export function roleHomePath(role: PublicRole) {
  const root = routeSpec(`${role}-root`);
  if (!root.replaceWith) throw new Error(`Role root has no default: ${role}`);
  return buildWebPath(root.replaceWith.routeId, root.replaceWith.params);
}

export type ParsedWebRoute =
  | {
      readonly canonicalUrl: string;
      readonly matchedRouteId: string;
      readonly needsReplace: boolean;
      readonly params: Readonly<Record<string, string>>;
      readonly query: URLSearchParams;
      readonly role: PublicRole | null;
      readonly routeId: string;
      readonly status: "matched";
    }
  | {
      readonly status: "not-found";
    };

export function parseWebRoute(input: string | URL): ParsedWebRoute {
  const url =
    input instanceof URL ? input : new URL(input, "https://jingshu.invalid");
  for (const matchedSpec of WEB_ROUTE_MANIFEST) {
    const matchedParams = matchPathname(matchedSpec, url.pathname);
    if (!matchedParams) continue;

    const targetSpec = matchedSpec.replaceWith
      ? routeSpec(matchedSpec.replaceWith.routeId)
      : matchedSpec;
    const params = {
      ...matchedParams,
      ...(matchedSpec.replaceWith?.params ?? {}),
    };
    const query = normalizedQuery(targetSpec, url.searchParams);
    const canonicalUrl = buildWebPath(targetSpec.id, params, query);
    return {
      canonicalUrl,
      matchedRouteId: matchedSpec.id,
      needsReplace:
        `${url.pathname}${url.search}` !== canonicalUrl || url.hash.length > 0,
      params,
      query,
      role: targetSpec.role,
      routeId: targetSpec.id,
      status: "matched",
    };
  }
  return { status: "not-found" };
}

export function webRouteMetadata(routeId: string) {
  const spec = routeSpec(routeId);
  return {
    heading: spec.heading,
    indexable: spec.id === "public-root",
    role: spec.role,
    title: spec.title,
  } as const;
}
