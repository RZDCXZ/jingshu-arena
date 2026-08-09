import {
  Buildings,
  CalendarCheck,
  ChartLineUp,
  Cube,
  DeviceMobile,
  FileText,
  Gauge,
  House,
  IdentificationCard,
  Package,
  Pulse,
  Repeat,
  SlidersHorizontal,
  Storefront,
  UsersThree,
  Wrench,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import type { PublicRole } from "@jingshu/contracts";

interface RoleMeta {
  readonly defaultPage: string;
  readonly icon: PhosphorIcon;
  readonly label: string;
  readonly navigation: ReadonlyArray<readonly [string, string, PhosphorIcon]>;
  readonly persona: string;
  readonly scope: string;
}

export const publicRoleCards = [
  {
    description: "从两小时立即预约开始，体验模拟支付、商品订单与座位报修。",
    icon: DeviceMobile,
    id: "customer",
    label: "顾客",
    persona: "林澈",
    recommended: true,
    scope: "浏览三店 · 只管理自己的记录",
  },
  {
    description: "办理到店、推进商品履约、处理报修与备件、完成交接。",
    icon: IdentificationCard,
    id: "staff",
    label: "店员",
    persona: "周宁",
    recommended: false,
    scope: "棱镜旗舰店",
  },
  {
    description: "验证维修、查看单店经营、管理库存、员工排班与配置。",
    icon: Storefront,
    id: "manager",
    label: "店长",
    persona: "许知远",
    recommended: false,
    scope: "棱镜旗舰店",
  },
  {
    description: "横向比较经营结果、维护连锁配置并导出当前筛选数据。",
    icon: Buildings,
    id: "hq",
    label: "总部运营",
    persona: "沈微",
    recommended: false,
    scope: "固定三店",
  },
] as const satisfies ReadonlyArray<{
  id: PublicRole;
  label: string;
  persona: string;
  scope: string;
  description: string;
  recommended: boolean;
  icon: PhosphorIcon;
}>;

const [customerCard, staffCard, managerCard, hqCard] = publicRoleCards;

export const roleMeta = {
  customer: {
    ...customerCard,
    defaultPage: "customer-home",
    navigation: [
      ["customer-home", "顾客 H5", House],
      ["customer-reservations", "我的预约", CalendarCheck],
      ["customer-orders", "我的订单", Package],
      ["customer-repairs", "我的报修", Wrench],
    ],
  },
  staff: {
    ...staffCard,
    defaultPage: "workbench",
    navigation: [
      ["workbench", "工作台", Pulse],
      ["reservations", "预约", CalendarCheck],
      ["orders", "商品订单", Package],
      ["repairs", "报修", Wrench],
      ["inventory", "库存", Cube],
      ["shift", "班次与交接", Repeat],
    ],
  },
  manager: {
    ...managerCard,
    defaultPage: "store-dashboard",
    navigation: [
      ["store-dashboard", "经营看板", Gauge],
      ["live-ops", "现场运营", Pulse],
      ["manager-inventory", "库存", Cube],
      ["store-config", "门店配置", SlidersHorizontal],
      ["people-schedule", "员工与排班", UsersThree],
      ["store-audit", "审计与导出", FileText],
    ],
  },
  hq: {
    ...hqCard,
    defaultPage: "chain-dashboard",
    navigation: [
      ["chain-dashboard", "连锁看板", Buildings],
      ["store-compare", "门店比较", ChartLineUp],
      ["chain-config", "连锁配置", SlidersHorizontal],
      ["hq-store-config", "门店配置", Storefront],
      ["hq-people", "人员与排班", UsersThree],
      ["hq-audit", "审计与导出", FileText],
    ],
  },
} as const satisfies Record<PublicRole, RoleMeta>;

export type RolePageId = (typeof roleMeta)[PublicRole]["navigation"][number][0];
