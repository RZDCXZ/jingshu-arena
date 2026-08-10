import {
  Armchair,
  ArrowClockwise,
  CalendarBlank,
  Camera,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Circle,
  ClipboardText,
  Clock,
  CloudSlash,
  Coffee,
  Cookie,
  CurrencyCny,
  Database,
  ForkKnife,
  GameController,
  GearSix,
  HardDrive,
  Headphones,
  House,
  ImageSquare,
  Images,
  Info,
  Lightning,
  ListChecks,
  Lock,
  MagnifyingGlass,
  MapPin,
  Minus,
  Monitor,
  Package,
  Plus,
  Pulse,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Star,
  Storefront,
  Ticket,
  Trash,
  TrendUp,
  UserCircle,
  Warning,
  Wrench,
  X,
  type IconProps,
} from "@phosphor-icons/react";
import {
  BottomSheet,
  Carousel,
  FlowStack,
  KeyboardTextarea,
  MobileScroll,
  type FlowControls,
  type FlowScreen,
} from "./mobile";
import {
  createContext,
  type ComponentType,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ReservationStatus =
  | "none"
  | "pending"
  | "confirmed"
  | "arrived"
  | "active"
  | "completed"
  | "cancelled"
  | "expired";
type OrderStatus = "none" | "pending" | "paid" | "making" | "pickup" | "completed" | "cancelled" | "expired";
type RepairStatus = "none" | "new" | "assigned" | "processing" | "verification" | "closed";
type TabId = "home" | "stores" | "trips" | "member";
type StoreId = "prism" | "starbridge" | "pole";
type MachineId = "standard" | "competitive" | "flagship";
type ReservationDateId = "today" | "08-09" | "08-10" | "08-11" | "08-12" | "08-13" | "08-14";
type IconComponent = ComponentType<IconProps>;

const storeProfiles: Record<StoreId, { name: string; hours: string }> = {
  prism: { name: "棱镜旗舰店", hours: "24 小时营业" },
  starbridge: { name: "星桥标准店", hours: "10:00–次日 02:00" },
  pole: { name: "极点新店", hours: "12:00–24:00" },
};

const machineProfiles: Record<MachineId, { name: string; spec: string; hourlyRate: number; icon: IconComponent }> = {
  standard: { name: "标准型", spec: "1080p / 144Hz", hourlyRate: 10, icon: Monitor },
  competitive: { name: "竞技型", spec: "2K / 180Hz", hourlyRate: 15, icon: GameController },
  flagship: { name: "旗舰型", spec: "2K / 240Hz", hourlyRate: 22, icon: Lightning },
};

const reservationDateOptions: Array<{ id: ReservationDateId; label: string; longLabel: string }> = [
  { id: "today", label: "今天", longLabel: "08月08日" },
  { id: "08-09", label: "周日 08/09", longLabel: "08月09日" },
  { id: "08-10", label: "周一 08/10", longLabel: "08月10日" },
  { id: "08-11", label: "周二 08/11", longLabel: "08月11日" },
  { id: "08-12", label: "周三 08/12", longLabel: "08月12日" },
  { id: "08-13", label: "周四 08/13", longLabel: "08月13日" },
  { id: "08-14", label: "周五 08/14", longLabel: "08月14日" },
];

const demoNowMinutes = 19 * 60 + 30;

function formatClock(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function dateProfile(id: ReservationDateId) {
  return reservationDateOptions.find((option) => option.id === id) ?? reservationDateOptions[0];
}

function formatTimeRange(startMinutes: number, durationHours: number) {
  const endMinutes = startMinutes + durationHours * 60;
  return `${formatClock(startMinutes)}–${endMinutes >= 1440 ? "次日 " : ""}${formatClock(endMinutes)}`;
}

function reservationQuote(machineId: MachineId, dateId: ReservationDateId, startMinutes: number, durationHours: number) {
  const machine = machineProfiles[machineId];
  const segments = Array.from({ length: durationHours * 2 }, (_, index) => {
    const segmentStart = startMinutes + index * 30;
    const hour = Math.floor((segmentStart % 1440) / 60);
    const weekend = dateId === "08-09";
    const multiplier = weekend ? 1.15 : hour < 6 ? 0.9 : hour >= 18 ? 1.2 : 1;
    const amount = Math.round((machine.hourlyRate / 2) * multiplier * 100) / 100;
    return {
      label: `${formatClock(segmentStart)}–${segmentStart + 30 >= 1440 ? "次日 " : ""}${formatClock(segmentStart + 30)}`,
      rule: weekend ? "周末 1.15 倍" : hour < 6 ? "夜间 0.90 倍" : hour >= 18 ? "晚间 1.20 倍" : "基础价",
      amount,
    };
  });
  const subtotal = Math.round(segments.reduce((sum, segment) => sum + segment.amount, 0) * 100) / 100;
  const discount = Math.min(6, subtotal);
  const total = Math.round((subtotal - discount) * 100) / 100;
  return { segments, subtotal, discount, total };
}

type DemoState = {
  reservationStatus: ReservationStatus;
  setReservationStatus: (status: ReservationStatus) => void;
  orderStatus: OrderStatus;
  setOrderStatus: (status: OrderStatus) => void;
  repairStatus: RepairStatus;
  setRepairStatus: (status: RepairStatus) => void;
  selectedSeat: string;
  setSelectedSeat: (seat: string) => void;
  selectedStore: StoreId;
  setSelectedStore: (store: StoreId) => void;
  selectedDate: ReservationDateId;
  setSelectedDate: (date: ReservationDateId) => void;
  startMinutes: number;
  setStartMinutes: (minutes: number) => void;
  durationHours: number;
  setDurationHours: (hours: number) => void;
  machineId: MachineId;
  setMachineId: (machine: MachineId) => void;
  reservationCoupon: boolean;
  setReservationCoupon: (selected: boolean) => void;
  bookingMode: "immediate" | "future";
  setBookingMode: (mode: "immediate" | "future") => void;
  cart: Record<string, number>;
  changeCart: (id: string, delta: number) => void;
  repairDescription: string;
  setRepairDescription: (value: string) => void;
  repairPhoto: boolean;
  setRepairPhoto: (value: boolean) => void;
  reset: () => void;
};

const DemoContext = createContext<DemoState | null>(null);

const products = [
  { id: "spark", name: "脉冲气泡水", note: "低糖 · 冰柜取用", price: 8, icon: Coffee, stock: 18 },
  { id: "chips", name: "夜航薯片", note: "海盐味 · 柜台取货", price: 10, icon: Cookie, stock: 7 },
  { id: "noodles", name: "热浪杯面", note: "微辣 · 柜台冲泡", price: 12, icon: ForkKnife, stock: 9 },
  { id: "bar", name: "跃迁能量棒", note: "可可味 · 独立包装", price: 9, icon: Lightning, stock: 3 },
  { id: "wipe", name: "外设清洁湿巾", note: "单片装 · 无香型", price: 6, icon: Package, stock: 12 },
  { id: "mint", name: "清醒薄荷糖", note: "小盒装 · 无糖", price: 5, icon: Star, stock: 20 },
] as const;

const initialCart = { spark: 1, chips: 1 };

function readPersistedState() {
  try {
    const raw = window.localStorage.getItem("jingshu-mini-demo-v1");
    if (!raw) return null;
    return JSON.parse(raw) as Partial<{
      reservationStatus: ReservationStatus;
      orderStatus: OrderStatus;
      repairStatus: RepairStatus;
      selectedSeat: string;
      selectedStore: StoreId;
      selectedDate: ReservationDateId;
      startMinutes: number;
      durationHours: number;
      machineId: MachineId;
      reservationCoupon: boolean;
      bookingMode: "immediate" | "future";
      cart: Record<string, number>;
      repairDescription: string;
      repairPhoto: boolean;
    }>;
  } catch {
    return null;
  }
}

function DemoProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(readPersistedState, []);
  const [reservationStatus, setReservationStatus] = useState<ReservationStatus>(persisted?.reservationStatus ?? "none");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(persisted?.orderStatus ?? "none");
  const [repairStatus, setRepairStatus] = useState<RepairStatus>(persisted?.repairStatus ?? "none");
  const [selectedSeat, setSelectedSeat] = useState(persisted?.selectedSeat ?? "A-18");
  const [selectedStore, setSelectedStore] = useState<StoreId>(persisted?.selectedStore ?? "prism");
  const [selectedDate, setSelectedDate] = useState<ReservationDateId>(persisted?.selectedDate ?? "today");
  const [startMinutes, setStartMinutes] = useState(persisted?.startMinutes ?? demoNowMinutes);
  const [durationHours, setDurationHours] = useState(persisted?.durationHours ?? 2);
  const [machineId, setMachineId] = useState<MachineId>(persisted?.machineId ?? "competitive");
  const [reservationCoupon, setReservationCoupon] = useState(persisted?.reservationCoupon ?? true);
  const [bookingMode, setBookingMode] = useState<"immediate" | "future">(
    persisted?.bookingMode ?? (persisted?.selectedDate === "today" && persisted?.startMinutes === demoNowMinutes ? "immediate" : persisted?.selectedDate || persisted?.startMinutes ? "future" : "immediate"),
  );
  const [cart, setCart] = useState<Record<string, number>>(persisted?.cart ?? initialCart);
  const [repairDescription, setRepairDescription] = useState(
    persisted?.repairDescription ?? "耳机右声道无声",
  );
  const [repairPhoto, setRepairPhoto] = useState(persisted?.repairPhoto ?? false);

  useEffect(() => {
    window.localStorage.setItem(
      "jingshu-mini-demo-v1",
      JSON.stringify({
        reservationStatus,
        orderStatus,
        repairStatus,
        selectedSeat,
        selectedStore,
        selectedDate,
        startMinutes,
        durationHours,
        machineId,
        reservationCoupon,
        bookingMode,
        cart,
        repairDescription,
        repairPhoto,
      }),
    );
  }, [bookingMode, cart, durationHours, machineId, orderStatus, repairDescription, repairPhoto, repairStatus, reservationCoupon, reservationStatus, selectedDate, selectedSeat, selectedStore, startMinutes]);

  const reset = () => {
    setReservationStatus("none");
    setOrderStatus("none");
    setRepairStatus("none");
    setSelectedSeat("A-18");
    setSelectedStore("prism");
    setSelectedDate("today");
    setStartMinutes(demoNowMinutes);
    setDurationHours(2);
    setMachineId("competitive");
    setReservationCoupon(true);
    setBookingMode("immediate");
    setCart(initialCart);
    setRepairDescription("耳机右声道无声");
    setRepairPhoto(false);
    window.localStorage.removeItem("jingshu-mini-demo-v1");
  };

  const changeCart = (id: string, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      return { ...current, [id]: next };
    });
  };

  return (
    <DemoContext.Provider
      value={{
        reservationStatus,
        setReservationStatus,
        orderStatus,
        setOrderStatus,
        repairStatus,
        setRepairStatus,
        selectedSeat,
        setSelectedSeat,
        selectedStore,
        setSelectedStore,
        selectedDate,
        setSelectedDate,
        startMinutes,
        setStartMinutes,
        durationHours,
        setDurationHours,
        machineId,
        setMachineId,
        reservationCoupon,
        setReservationCoupon,
        bookingMode,
        setBookingMode,
        cart,
        changeCart,
        repairDescription,
        setRepairDescription,
        repairPhoto,
        setRepairPhoto,
        reset,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}

export default function Prototype() {
  const initial = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("screen");
    if (requested) return screenForId(requested);
    return window.localStorage.getItem("jingshu-mini-intro-seen") === "true" ? rootScreen("home") : launchScreen();
  }, []);

  return (
    <div className="jingshu-root">
      <DemoProvider>
        <FlowStack initial={initial} />
      </DemoProvider>
    </div>
  );
}

function launchScreen(): FlowScreen {
  return {
    id: "MP-00",
    render: (flow) => <LaunchScreen flow={flow} />,
  };
}

function rootScreen(tab: TabId): FlowScreen {
  const meta = {
    home: { id: "MP-01", render: (flow: FlowControls) => <HomeScreen flow={flow} /> },
    stores: { id: "MP-03", render: (flow: FlowControls) => <StoreListScreen flow={flow} /> },
    trips: { id: "MP-16", render: (flow: FlowControls) => <TripsScreen flow={flow} /> },
    member: { id: "MP-17", render: (flow: FlowControls) => <MemberScreen flow={flow} /> },
  }[tab];

  return {
    id: meta.id,
    footerHeight: 70,
    footer: (flow) => <BottomNav active={tab} flow={flow} />,
    render: meta.render,
  };
}

function detailScreen(
  id: string,
  title: string,
  render: (flow: FlowControls) => ReactNode,
  options?: {
    eyebrow?: string;
    footer?: (flow: FlowControls) => ReactNode;
    footerHeight?: number;
    right?: (flow: FlowControls) => ReactNode;
  },
): FlowScreen {
  return {
    id,
    headerHeight: 54,
    header: (flow) => (
      <AppHeader
        title={title}
        eyebrow={options?.eyebrow ?? id}
        onBack={flow.pop}
        right={options?.right?.(flow)}
      />
    ),
    footer: options?.footer,
    footerHeight: options?.footerHeight,
    render,
  };
}

function guideScreen() {
  return detailScreen("MP-02", "演示引导", (flow) => <GuideScreen flow={flow} />);
}

function storeDetailScreen() {
  return detailScreen("MP-04", "棱镜旗舰店", (flow) => <StoreDetailScreen flow={flow} />, {
    footerHeight: 70,
    footer: (flow) => <StoreDetailFooter flow={flow} />,
  });
}

function reservationConditionsScreen() {
  return detailScreen("MP-05", "预约条件", (flow) => <ReservationConditionsScreen flow={flow} />, {
    footerHeight: 70,
    footer: (flow) => <SingleActionFooter label="查看可订座位" onClick={() => flow.push(seatMapScreen())} />,
  });
}

function seatMapScreen() {
  return detailScreen("MP-06", "选择座位", () => <SeatMapScreen />, {
    footerHeight: 84,
    footer: (flow) => <SeatSelectionFooter flow={flow} />,
  });
}

function reservationConfirmScreen() {
  return detailScreen("MP-07", "确认预约", () => <ReservationConfirmScreen />, {
    footerHeight: 78,
    footer: (flow) => <ReservationSubmitFooter flow={flow} />,
  });
}

function reservationPaymentScreen() {
  return detailScreen("MP-08", "预约模拟支付", (flow) => <ReservationPaymentScreen flow={flow} />);
}

function reservationDetailScreen() {
  return detailScreen("MP-09", "预约详情", (flow) => <ReservationDetailScreen flow={flow} />, {
    right: () => <StatusPill tone="cyan">本地故事</StatusPill>,
  });
}

function productCatalogScreen() {
  return detailScreen("MP-10", "柜台商品", () => <ProductCatalogScreen />, {
    footerHeight: 76,
    footer: (flow) => <CartFooter flow={flow} />,
  });
}

function orderConfirmScreen() {
  return detailScreen("MP-11", "确认商品订单", () => <OrderConfirmScreen />, {
    footerHeight: 78,
    footer: (flow) => <OrderSubmitFooter flow={flow} />,
  });
}

function orderDetailScreen() {
  return detailScreen("MP-12", "商品订单详情", (flow) => <OrderDetailScreen flow={flow} />);
}

function repairCreateScreen() {
  return detailScreen("MP-13", "座位报修", (flow) => <RepairCreateScreen flow={flow} />, {
    footerHeight: 70,
    footer: (flow) => <RepairSubmitFooter flow={flow} />,
  });
}

function imagePickerScreen() {
  return detailScreen("MP-14", "添加本地图片", (flow) => <ImagePickerScreen flow={flow} />);
}

function repairDetailScreen() {
  return detailScreen("MP-15", "报修详情", () => <RepairDetailScreen />);
}

function settingsScreen() {
  return detailScreen("MP-18", "本地演示设置", (flow) => <SettingsScreen flow={flow} />);
}

function systemStateScreen() {
  return detailScreen("MP-19", "通用系统状态", () => <SystemStateScreen />);
}

function screenIndexScreen() {
  return detailScreen("INDEX", "设计稿索引", (flow) => <ScreenIndexScreen flow={flow} />, {
    eyebrow: "REVIEW INDEX",
  });
}

function screenForId(id: string): FlowScreen {
  const normalized = id.toUpperCase();
  const screens: Record<string, () => FlowScreen> = {
    HOME: () => rootScreen("home"),
    "MP-00": launchScreen,
    "MP-01": () => rootScreen("home"),
    "MP-02": guideScreen,
    "MP-03": () => rootScreen("stores"),
    "MP-04": storeDetailScreen,
    "MP-05": reservationConditionsScreen,
    "MP-06": seatMapScreen,
    "MP-07": reservationConfirmScreen,
    "MP-08": reservationPaymentScreen,
    "MP-09": reservationDetailScreen,
    "MP-10": productCatalogScreen,
    "MP-11": orderConfirmScreen,
    "MP-12": orderDetailScreen,
    "MP-13": repairCreateScreen,
    "MP-14": imagePickerScreen,
    "MP-15": repairDetailScreen,
    "MP-16": () => rootScreen("trips"),
    "MP-17": () => rootScreen("member"),
    "MP-18": settingsScreen,
    "MP-19": systemStateScreen,
    INDEX: screenIndexScreen,
  };
  return (screens[normalized] ?? screens.HOME)();
}

function AppHeader({
  title,
  eyebrow,
  onBack,
  right,
}: {
  title: string;
  eyebrow: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="app-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回">
        <CaretLeft size={22} weight="bold" />
      </button>
      <div className="app-header-title">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      <div className="app-header-right">{right}</div>
    </div>
  );
}

function BottomNav({ active, flow }: { active: TabId; flow: FlowControls }) {
  const items: Array<{ id: TabId; label: string; icon: IconComponent }> = [
    { id: "home", label: "首页", icon: House },
    { id: "stores", label: "门店", icon: Storefront },
    { id: "trips", label: "行程", icon: CalendarBlank },
    { id: "member", label: "会员", icon: UserCircle },
  ];
  return (
    <nav className="bottom-nav" aria-label="一级导航">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? "active" : ""}
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => {
              if (active !== item.id) flow.replace(rootScreen(item.id));
            }}
          >
            <Icon size={24} weight={active === item.id ? "fill" : "regular"} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "brand-header compact" : "brand-header"}>
      <div className="brand-lockup">
        <img src="/assets/jingshu-mark.png" alt="竞枢品牌标志" />
        <div>
          <strong>竞枢</strong>
          <span>JINGSHU ARENA</span>
        </div>
      </div>
      {!compact ? (
        <div className="member-glance">
          <div>
            <strong>林澈</strong>
            <span>白银会员</span>
          </div>
          <div className="growth-glance">
            <strong>860</strong>
            <span>成长值</span>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LocalDemoStrip({ flow, compact = false }: { flow: FlowControls; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={compact ? "local-strip compact" : "local-strip"} type="button" onClick={() => setOpen(true)}>
        <Monitor size={19} />
        <strong>本地演示</strong>
        <span>仅保存在此设备 · 不与 Web 同步</span>
        <CaretRight size={16} />
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="本地演示"
        description="全部人物、金额和经营记录均为合成数据"
        snap={0.78}
      >
        <div className="sheet-stack">
          <Notice tone="info" icon={HardDrive} title="只保存在当前设备">
            关闭后会恢复上次故事；数据不会请求竞枢 Web API，也不会与 Web 沙箱同步。
          </Notice>
          <div className="sheet-actions-grid">
            <button type="button" onClick={() => { setOpen(false); flow.push(guideScreen()); }}>
              <ListChecks size={21} />
              <span><strong>演示引导</strong><small>查看顾客闭环进度</small></span>
            </button>
            <button type="button" onClick={() => { setOpen(false); flow.push(screenIndexScreen()); }}>
              <ClipboardText size={21} />
              <span><strong>设计稿索引</strong><small>访问 MP-00 至 MP-19</small></span>
            </button>
            <button type="button" onClick={() => { setOpen(false); flow.push(settingsScreen()); }}>
              <GearSix size={21} />
              <span><strong>演示设置</strong><small>查看版本或重置故事</small></span>
            </button>
            <button type="button" onClick={() => { setOpen(false); flow.push(systemStateScreen()); }}>
              <Warning size={21} />
              <span><strong>异常状态</strong><small>恢复与权限回退稿</small></span>
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "lime" | "cyan" | "amber" | "red" | "neutral" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "info" | "warning" | "danger" | "success";
  icon: IconComponent;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice ${tone}`}>
      <Icon size={20} weight="bold" />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="page-intro">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled = false }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="primary-button" type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, danger = false }: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button className={danger ? "secondary-button danger" : "secondary-button"} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function SingleActionFooter({ label, sublabel, onClick, disabled = false }: { label: string; sublabel?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="action-footer">
      {sublabel ? <span>{sublabel}</span> : null}
      <PrimaryButton onClick={onClick} disabled={disabled}>{label}</PrimaryButton>
    </div>
  );
}

function StepRail({ labels, active }: { labels: string[]; active: number }) {
  return (
    <div className="step-rail" aria-label={`当前步骤：${labels[active]}`}>
      {labels.map((label, index) => (
        <div className={index < active ? "done" : index === active ? "active" : ""} key={label}>
          <span>{index < active ? <Check size={14} weight="bold" /> : index + 1}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function FieldRow({ icon: Icon, label, value, onClick, meta }: { icon: IconComponent; label: string; value: string; onClick?: () => void; meta?: string }) {
  const content = (
    <>
      <Icon size={22} />
      <span className="field-copy"><small>{label}</small><strong>{value}</strong>{meta ? <em>{meta}</em> : null}</span>
      {onClick ? <CaretRight size={18} /> : null}
    </>
  );
  return onClick ? <button className="field-row" type="button" onClick={onClick}>{content}</button> : <div className="field-row static">{content}</div>;
}

function LaunchScreen({ flow }: { flow: FlowControls }) {
  const [phase, setPhase] = useState<"ready" | "loading">("ready");
  const enter = () => {
    setPhase("loading");
    window.setTimeout(() => {
      window.localStorage.setItem("jingshu-mini-intro-seen", "true");
      flow.replace(rootScreen("home"));
    }, 650);
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="launch-screen" data-screen-id="MP-00">
        <BrandHeader compact />
        <div className="launch-mark"><img src="/assets/jingshu-mark.png" alt="" aria-hidden="true" /></div>
        <span className="eyebrow">LOCAL DEMO SANDBOX</span>
        <h1>{phase === "loading" ? "正在创建本地演示" : "在本机走完顾客故事"}</h1>
        <p>预约一个明确座位，完成不扣款的模拟支付，再体验商品、报修与状态历史。</p>
        <div className="launch-progress" aria-label="本地沙箱初始化状态">
          <span className="complete"><CheckCircle size={18} weight="fill" />schema v1.0</span>
          <span className={phase === "loading" ? "active" : "complete"}><Database size={18} />标准种子</span>
          <span><ShieldCheck size={18} />可安全重置</span>
        </div>
        <Notice tone="info" icon={CloudSlash} title="演示边界">
          不要求真实身份，不发生真实支付，也不与 Web 沙箱同步。
        </Notice>
        <PrimaryButton onClick={enter} disabled={phase === "loading"}>
          {phase === "loading" ? <><ArrowClockwise className="spin" size={21} />正在初始化…</> : "进入本地演示"}
        </PrimaryButton>
        <small className="launch-footnote">所有门店、人物、订单与金额均为虚构合成数据</small>
      </main>
    </MobileScroll>
  );
}

function HomeScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [picker, setPicker] = useState<"store" | "time" | "duration" | "machine" | null>(null);
  const hasReservation = demo.reservationStatus !== "none";
  const store = storeProfiles[demo.selectedStore];
  const machine = machineProfiles[demo.machineId];
  const selectedDate = dateProfile(demo.selectedDate);
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const startLabel = demo.bookingMode === "immediate" && demo.selectedDate === "today" && demo.startMinutes === demoNowMinutes
    ? `现在 · ${formatClock(demo.startMinutes)}`
    : `${selectedDate.label} · ${formatClock(demo.startMinutes)}`;
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="root-content home-screen" data-screen-id="MP-01">
        <BrandHeader />
        <LocalDemoStrip flow={flow} />
        {hasReservation ? (
          <ActiveReservationHome flow={flow} />
        ) : (
          <>
            <PageIntro eyebrow="RESERVATION" title="预约座位" description="选门店、时段和机型，再挑一个明确座位" />
            <StepRail labels={["选时段", "选座位", "确认"]} active={0} />
            <div className="segmented" aria-label="预约类型">
              <button className={demo.bookingMode === "immediate" ? "active" : ""} type="button" aria-pressed={demo.bookingMode === "immediate"} onClick={() => { demo.setBookingMode("immediate"); demo.setSelectedDate("today"); demo.setStartMinutes(demoNowMinutes); }}>
                <Lightning size={18} weight="fill" />立即预约
              </button>
              <button className={demo.bookingMode === "future" ? "active" : ""} type="button" aria-pressed={demo.bookingMode === "future"} onClick={() => { demo.setBookingMode("future"); if (demo.selectedDate === "today" && demo.startMinutes <= demoNowMinutes) demo.setStartMinutes(demoNowMinutes + 30); flow.push(reservationConditionsScreen()); }}>
                <CalendarBlank size={18} />预约未来时段
              </button>
            </div>
            <div className="field-group">
              <FieldRow icon={Storefront} label="门店" value={`${store.name} · ${store.hours}`} onClick={() => setPicker("store")} />
              <FieldRow icon={Clock} label="开始时间" value={startLabel} onClick={() => setPicker("time")} />
              <FieldRow icon={CalendarBlank} label="使用时长" value={`${demo.durationHours} 小时 · 至 ${demo.startMinutes + demo.durationHours * 60 >= 24 * 60 ? "次日 " : ""}${formatClock(demo.startMinutes + demo.durationHours * 60)}`} onClick={() => setPicker("duration")} />
              <FieldRow icon={Monitor} label="机型" value={`${machine.name} · ${machine.spec}`} onClick={() => setPicker("machine")} />
            </div>
            <div className="price-action">
              <div><span><CurrencyCny size={19} />预计模拟金额</span><strong>¥{quote.total.toFixed(2)}</strong></div>
              <PrimaryButton onClick={() => flow.push(seatMapScreen())}><MagnifyingGlass size={23} weight="bold" />查找可订座位</PrimaryButton>
              <small>后续为模拟支付（不扣款）</small>
            </div>
          </>
        )}
      </main>
      <BookingPicker type={picker} onClose={() => setPicker(null)} flow={flow} />
    </MobileScroll>
  );
}

function ActiveReservationHome({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const { reservationStatus, selectedSeat } = demo;
  const machine = machineProfiles[demo.machineId];
  const store = storeProfiles[demo.selectedStore];
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const statusLabels: Record<ReservationStatus, string> = {
    none: "无预约",
    pending: "待确认",
    confirmed: "已确认",
    arrived: "已到店",
    active: "使用中",
    completed: "已完成",
    cancelled: "已取消",
    expired: "已过期",
  };
  return (
    <section className="active-home">
      <div className="active-home-heading">
        <div><span className="eyebrow">CURRENT RESERVATION</span><h1>当前预约</h1></div>
        <StatusPill tone={reservationStatus === "active" ? "lime" : "cyan"}>{statusLabels[reservationStatus]}</StatusPill>
      </div>
      <StepRail labels={["已确认", "已到店", "使用中"]} active={reservationStatus === "confirmed" ? 0 : reservationStatus === "arrived" ? 1 : 2} />
      <div className="session-focus">
        <div><Armchair size={34} /><span><strong>竞技区 {selectedSeat}</strong><small>{machine.name} · {machine.spec}</small></span></div>
        <div><span>剩余使用时间</span><strong>01:59:45</strong></div>
      </div>
      <div className="field-group compact-fields">
        <FieldRow icon={Storefront} label="门店" value={store.name} />
        <FieldRow icon={Clock} label="使用时段" value={formatTimeRange(demo.startMinutes, demo.durationHours)} />
        <FieldRow icon={CurrencyCny} label="模拟金额" value={`¥${quote.total.toFixed(2)}`} />
      </div>
      <PrimaryButton onClick={() => flow.push(reservationDetailScreen())}>查看预约详情<CaretRight size={20} /></PrimaryButton>
      <SecondaryButton onClick={() => flow.push(reservationConditionsScreen())}>预约下一场</SecondaryButton>
    </section>
  );
}

function ScheduleDateStrip({ value, onChange }: { value: ReservationDateId; onChange: (date: ReservationDateId) => void }) {
  return (
    <Carousel ariaLabel="预约日期" className="chip-carousel schedule-date-carousel" contentClassName="chip-track schedule-date-track">
      {reservationDateOptions.map((option) => (
        <button className={value === option.id ? "active" : ""} type="button" aria-pressed={value === option.id} key={option.id} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </Carousel>
  );
}

function ScheduleTimeSelector({ value, durationHours, dateId, onChange }: { value: number; durationHours: number; dateId: ReservationDateId; onChange: (minutes: number) => void }) {
  const hourListRef = useRef<HTMLDivElement>(null);
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  const minimumMinutes = dateId === "today" ? demoNowMinutes : 0;
  useEffect(() => {
    if (hourListRef.current) hourListRef.current.scrollTop = Math.max(0, hour * 42 - 63);
  }, [hour]);
  const changeHour = (nextHour: number) => onChange(Math.max(minimumMinutes, nextHour * 60 + minute));
  const changeMinute = (nextMinute: number) => onChange(Math.max(minimumMinutes, hour * 60 + nextMinute));
  const nudge = (delta: number) => onChange(Math.max(minimumMinutes, Math.min(23 * 60 + 30, value + delta)));
  const endMinutes = value + durationHours * 60;
  return (
    <div className="schedule-time-selector">
      <div className="schedule-time-display" aria-live="polite">
        <span>{dateProfile(dateId).label} · 已选开始时间</span>
        <strong>{formatClock(value)}</strong>
        <small>预计结束：{endMinutes >= 1440 ? "次日 " : ""}{formatClock(endMinutes)}</small>
      </div>
      <div className="time-wheel" aria-label="自由选择开始时间">
        <div className="time-wheel-column">
          <span>小时</span>
          <div className="time-hour-options" ref={hourListRef} role="listbox" aria-label="小时">
            {Array.from({ length: 24 }, (_, index) => index).map((option) => (
              <button className={hour === option ? "active" : ""} type="button" role="option" aria-selected={hour === option} aria-label={`选择 ${String(option).padStart(2, "0")} 时`} disabled={dateId === "today" && option < Math.floor(demoNowMinutes / 60)} key={option} onClick={() => changeHour(option)}>
                {String(option).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
        <strong className="time-wheel-separator">:</strong>
        <div className="time-wheel-column minute-column">
          <span>分钟</span>
          <div className="time-minute-options" role="listbox" aria-label="分钟">
            {[0, 30].map((option) => (
              <button className={minute === option ? "active" : ""} type="button" role="option" aria-selected={minute === option} aria-label={`选择 ${String(option).padStart(2, "0")} 分`} disabled={dateId === "today" && hour === Math.floor(demoNowMinutes / 60) && option < demoNowMinutes % 60} key={option} onClick={() => changeMinute(option)}>
                {String(option).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="time-nudge-actions">
        <button type="button" disabled={value === minimumMinutes} onClick={() => nudge(-30)}><Minus size={17} />提前 30 分钟</button>
        <button type="button" disabled={value === 23 * 60 + 30} onClick={() => nudge(30)}>延后 30 分钟<Plus size={17} /></button>
      </div>
    </div>
  );
}

function DurationSelector({ value, startMinutes, onChange }: { value: number; startMinutes: number; onChange: (hours: number) => void }) {
  return (
    <div className="duration-selector">
      <div className="duration-stepper">
        <button type="button" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} aria-label="减少一小时"><Minus size={21} /></button>
        <div><strong>{value}</strong><span>小时</span><small>{formatTimeRange(startMinutes, value)}</small></div>
        <button type="button" disabled={value >= 8} onClick={() => onChange(Math.min(8, value + 1))} aria-label="增加一小时"><Plus size={21} /></button>
      </div>
      <input aria-label="使用时长" type="range" min="1" max="8" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="duration-range-labels"><span>1 小时</span><span>4 小时</span><span>8 小时</span></div>
    </div>
  );
}

function BookingPicker({ type, onClose, flow }: { type: "store" | "time" | "duration" | "machine" | null; onClose: () => void; flow: FlowControls }) {
  const demo = useDemo();
  const title = type === "store" ? "选择门店" : type === "time" ? "选择开始时间" : type === "duration" ? "使用时长" : "选择机型";
  const changeDate = (date: ReservationDateId) => {
    demo.setSelectedDate(date);
    const nextMinutes = date === "today" ? Math.max(demoNowMinutes, demo.startMinutes) : demo.startMinutes;
    demo.setStartMinutes(nextMinutes);
    demo.setBookingMode(date === "today" && nextMinutes === demoNowMinutes ? "immediate" : "future");
  };
  const changeTime = (minutes: number) => {
    demo.setStartMinutes(minutes);
    demo.setBookingMode(demo.selectedDate === "today" && minutes === demoNowMinutes ? "immediate" : "future");
  };
  const resetToNow = () => {
    demo.setSelectedDate("today");
    demo.setStartMinutes(demoNowMinutes);
    demo.setBookingMode("immediate");
  };
  return (
    <BottomSheet open={type !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={title} description={type === "time" ? "按 30 分钟对齐，可自由选择未来 7 天" : "当前选择只用于本机演示"} snap={type === "time" ? 0.86 : type === "duration" ? 0.58 : 0.72}>
      {type === "time" ? (
        <div className="sheet-stack schedule-sheet">
          <ScheduleDateStrip value={demo.selectedDate} onChange={changeDate} />
          <ScheduleTimeSelector value={demo.startMinutes} durationHours={demo.durationHours} dateId={demo.selectedDate} onChange={changeTime} />
          <div className="sheet-footer-actions">
            <SecondaryButton onClick={resetToNow}>恢复当前 · 19:30</SecondaryButton>
            <PrimaryButton onClick={onClose}>确认时间</PrimaryButton>
          </div>
          <button className="text-link centered" type="button" onClick={() => { demo.setBookingMode("future"); onClose(); flow.push(reservationConditionsScreen()); }}>进入完整预约条件<CaretRight size={17} /></button>
        </div>
      ) : type === "duration" ? (
        <div className="sheet-stack">
          <DurationSelector value={demo.durationHours} startMinutes={demo.startMinutes} onChange={demo.setDurationHours} />
          <PrimaryButton onClick={onClose}>确认使用时长</PrimaryButton>
        </div>
      ) : (
        <div className="sheet-list single-select-list" role="radiogroup" aria-label={title}>
          {type === "machine" ? (Object.entries(machineProfiles) as Array<[MachineId, (typeof machineProfiles)[MachineId]]>).map(([id, machine]) => {
            const selected = demo.machineId === id;
            return <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => { demo.setMachineId(id); onClose(); }}><span>{machine.name} · {machine.spec}</span>{selected ? <CheckCircle size={21} weight="fill" /> : <Circle size={21} />}</button>;
          }) : (Object.entries(storeProfiles) as Array<[StoreId, (typeof storeProfiles)[StoreId]]>).map(([id, store]) => {
            const selected = demo.selectedStore === id;
            return <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => { demo.setSelectedStore(id); onClose(); }}><span>{store.name} · {store.hours}</span>{selected ? <CheckCircle size={21} weight="fill" /> : <Circle size={21} />}</button>;
          })}
        </div>
      )}
    </BottomSheet>
  );
}

function StoreListScreen({ flow }: { flow: FlowControls }) {
  const stores = [
    { name: "棱镜旗舰店", tag: "主演示门店", status: "营业中", hours: "24 小时", seats: "96 座", price: "¥10 起", tone: "lime" as const },
    { name: "星桥标准店", tag: "跨午夜营业", status: "营业中", hours: "10:00–次日 02:00", seats: "64 座", price: "¥8 起", tone: "cyan" as const },
    { name: "极点新店", tag: "设备故事", status: "营业中", hours: "12:00–24:00", seats: "40 座", price: "¥7 起", tone: "amber" as const },
  ];
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="root-content store-list-screen" data-screen-id="MP-03">
        <div className="root-title"><div><span className="eyebrow">THREE FICTIONAL STORES</span><h1>选择门店</h1></div><button className="icon-button" type="button" onClick={() => flow.push(screenIndexScreen())} aria-label="设计稿索引"><ClipboardText size={21} /></button></div>
        <LocalDemoStrip flow={flow} compact />
        <p className="muted-lead">三家门店都位于虚构城市“栖光市”，不对应真实地址。</p>
        <div className="store-list">
          {stores.map((store, index) => (
            <button key={store.name} type="button" className="store-card" onClick={() => flow.push(storeDetailScreen())}>
              <div className="store-card-top"><span className={`store-index ${store.tone}`}>0{index + 1}</span><StatusPill tone={store.tone}>{store.status}</StatusPill></div>
              <div><small>{store.tag}</small><h2>{store.name}</h2></div>
              <div className="store-facts"><span><Clock size={17} />{store.hours}</span><span><Armchair size={17} />{store.seats}</span><span><CurrencyCny size={17} />{store.price}</span></div>
              <span className="row-link">查看门店与预约<CaretRight size={18} /></span>
            </button>
          ))}
        </div>
        <Notice tone="info" icon={MapPin} title="虚构位置">
          设计稿不申请真实定位权限，也不展示可映射到现实的详细地址。
        </Notice>
      </main>
    </MobileScroll>
  );
}

function StoreDetailScreen({ flow }: { flow: FlowControls }) {
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content" data-screen-id="MP-04">
        <section className="store-hero">
          <div><span className="eyebrow">栖光市 · 虚构地点</span><h1>棱镜旗舰店</h1><p>24 小时营业 · 96 个座位 · 主演示发生地</p></div>
          <img src="/assets/jingshu-mark.png" alt="" aria-hidden="true" />
        </section>
        <div className="status-strip"><Pulse size={20} /><strong>现在营业中</strong><span>下一经营日边界 08月09日 06:00</span></div>
        <Section title="机型与价格" action="完整价格规则">
          <div className="machine-list">
            <FieldRow icon={Monitor} label="标准型" value="1080p / 144Hz" meta="¥10 / 小时起" />
            <FieldRow icon={GameController} label="竞技型" value="2K / 180Hz" meta="¥15 / 小时起" />
            <FieldRow icon={Lightning} label="旗舰型" value="2K / 240Hz" meta="¥22 / 小时起" />
          </div>
        </Section>
        <Section title="区域与座位">
          <div className="metric-grid"><div><strong>36</strong><span>竞技区</span></div><div><strong>32</strong><span>标准区</span></div><div><strong>28</strong><span>沉浸区</span></div></div>
        </Section>
        <Notice tone="info" icon={Info} title="演示门店">
          门店名称、营业数据与机型描述全部为合成内容，不代表真实服务。
        </Notice>
      </main>
    </MobileScroll>
  );
}

function StoreDetailFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  return (
    <div className="dual-action-footer">
      <SecondaryButton onClick={() => { demo.setBookingMode("future"); flow.push(reservationConditionsScreen()); }}>预约未来</SecondaryButton>
      <PrimaryButton onClick={() => { demo.setBookingMode("immediate"); flow.push(seatMapScreen()); }}>立即预约</PrimaryButton>
    </div>
  );
}

function ReservationConditionsScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [zone, setZone] = useState("竞技区");
  const changeDate = (date: ReservationDateId) => {
    demo.setSelectedDate(date);
    const nextMinutes = date === "today" ? Math.max(demoNowMinutes, demo.startMinutes) : demo.startMinutes;
    demo.setStartMinutes(nextMinutes);
    demo.setBookingMode(date === "today" && nextMinutes === demoNowMinutes ? "immediate" : "future");
  };
  const changeTime = (minutes: number) => {
    demo.setStartMinutes(minutes);
    demo.setBookingMode(demo.selectedDate === "today" && minutes === demoNowMinutes ? "immediate" : "future");
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content has-fixed-footer" data-screen-id="MP-05">
        <StepRail labels={["选时段", "选座位", "确认"]} active={0} />
        <div className="segmented compact-segmented">
          <button className={demo.bookingMode === "immediate" ? "active" : ""} type="button" aria-pressed={demo.bookingMode === "immediate"} onClick={() => { demo.setBookingMode("immediate"); demo.setSelectedDate("today"); demo.setStartMinutes(demoNowMinutes); }}><Lightning size={17} />立即预约</button>
          <button className={demo.bookingMode === "future" ? "active" : ""} type="button" aria-pressed={demo.bookingMode === "future"} onClick={() => { demo.setBookingMode("future"); if (demo.selectedDate === "today" && demo.startMinutes <= demoNowMinutes) demo.setStartMinutes(demoNowMinutes + 30); }}><CalendarBlank size={17} />未来时段</button>
        </div>
        <Section title="日期">
          <ScheduleDateStrip value={demo.selectedDate} onChange={changeDate} />
        </Section>
        <Section title="开始时间" action="小时 + 00/30 分钟">
          <ScheduleTimeSelector value={demo.startMinutes} durationHours={demo.durationHours} dateId={demo.selectedDate} onChange={changeTime} />
        </Section>
        <Section title="使用时长" action="1–8 小时">
          <DurationSelector value={demo.durationHours} startMinutes={demo.startMinutes} onChange={demo.setDurationHours} />
        </Section>
        <Section title="区域与机型">
          <div className="choice-grid" role="radiogroup" aria-label="区域">{["竞技区", "标准区", "沉浸区"].map((item) => <button className={zone === item ? "active" : ""} type="button" role="radio" aria-checked={zone === item} key={item} onClick={() => setZone(item)}>{item}</button>)}</div>
          <div className="choice-list" role="radiogroup" aria-label="机型">{(Object.entries(machineProfiles) as Array<[MachineId, (typeof machineProfiles)[MachineId]]>).map(([id, machine]) => { const Icon = machine.icon; const selected = demo.machineId === id; return <button className={selected ? "active" : ""} type="button" role="radio" aria-checked={selected} key={id} onClick={() => demo.setMachineId(id)}><Icon size={20} /><span><strong>{machine.name}</strong><small>{machine.spec} · ¥{machine.hourlyRate}/小时起</small></span>{selected ? <CheckCircle size={21} weight="fill" /> : <Circle size={21} />}</button>; })}</div>
        </Section>
        {demo.selectedDate === "08-09" ? <Notice tone="warning" icon={Warning} title="周末价格规则">周末营业时段统一按基础价 1.15 倍生成价格快照。</Notice> : null}
        <button className="text-link" type="button" onClick={() => flow.push(systemStateScreen())}>查看冲突与越界状态稿<CaretRight size={17} /></button>
      </main>
    </MobileScroll>
  );
}

function SeatMapScreen() {
  const demo = useDemo();
  const machine = machineProfiles[demo.machineId];
  const seats = Array.from({ length: 24 }, (_, index) => `A-${String(index + 1).padStart(2, "0")}`);
  const reserved = new Set(["A-03", "A-07", "A-15"]);
  const active = new Set(["A-05", "A-12"]);
  const maintenance = new Set(["A-09", "A-21"]);
  const status = (seat: string) => maintenance.has(seat) ? "maintenance" : active.has(seat) ? "active" : reserved.has(seat) ? "reserved" : "available";
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content seat-map-content has-seat-footer" data-screen-id="MP-06">
        <div className="booking-summary"><div><CalendarBlank size={19} /><span><small>{dateProfile(demo.selectedDate).label}</small><strong>{formatTimeRange(demo.startMinutes, demo.durationHours)}</strong></span></div><div><Monitor size={19} /><span><small>{machine.name}</small><strong>{machine.spec}</strong></span></div></div>
        <StepRail labels={["选时段", "选座位", "确认"]} active={1} />
        <Carousel ariaLabel="座位区域" className="chip-carousel" contentClassName="chip-track">
          {["竞技区 A", "竞技区 B", "标准区", "沉浸区"].map((item, index) => <button className={index === 0 ? "active" : ""} type="button" key={item}>{item}</button>)}
        </Carousel>
        <div className="seat-map-header"><div><span className="eyebrow">竞技区 A · 24 座</span><h2>请选择一个座位</h2></div><span>屏幕方向 ↑</span></div>
        <div className="seat-grid" aria-label="竞技区 A 座位图">
          {seats.map((seat) => {
            const seatStatus = status(seat);
            const unavailable = seatStatus !== "available";
            const selected = demo.selectedSeat === seat;
            const label = seatStatus === "available" ? "可订" : seatStatus === "reserved" ? "已预留" : seatStatus === "active" ? "使用中" : "维护中";
            return <button key={seat} type="button" className={`seat ${seatStatus} ${selected ? "selected" : ""}`} disabled={unavailable} onClick={() => demo.setSelectedSeat(seat)} aria-label={`${seat}，${machine.name}，${label}`}><Armchair size={22} weight={selected ? "fill" : "regular"} /><span>{seat.replace("A-", "")}</span><small>{selected ? "已选" : unavailable ? label.slice(0, 2) : "可订"}</small></button>;
          })}
        </div>
        <div className="seat-legend"><span><Armchair size={17} />可订</span><span><Armchair size={17} weight="fill" />已选</span><span><Lock size={17} />已预留/使用中</span><span><Wrench size={17} />维护中</span></div>
        <Notice tone="info" icon={Info} title="按所选时段计算">
          “维护中”是座位运营状态；“已预留 / 使用中”由当前时段推导，二者含义不同。
        </Notice>
      </main>
    </MobileScroll>
  );
}

function SeatSelectionFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  return (
    <div className="seat-footer"><div><span>已选 · 竞技区</span><strong>{demo.selectedSeat} · 预计 ¥{quote.total.toFixed(2)}</strong></div><PrimaryButton onClick={() => flow.push(reservationConfirmScreen())}>继续确认</PrimaryButton></div>
  );
}

function ReservationSubmitFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const payable = demo.reservationCoupon ? quote.total : quote.subtotal;
  return <SingleActionFooter label="模拟支付（不扣款）" sublabel={`应付模拟金额 ¥${payable.toFixed(2)}`} onClick={() => flow.push(reservationPaymentScreen())} />;
}

function ReservationConfirmScreen() {
  const demo = useDemo();
  const [expanded, setExpanded] = useState(false);
  const store = storeProfiles[demo.selectedStore];
  const machine = machineProfiles[demo.machineId];
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const payable = demo.reservationCoupon ? quote.total : quote.subtotal;
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content confirm-content has-fixed-footer" data-screen-id="MP-07">
        <StepRail labels={["选时段", "选座位", "确认"]} active={2} />
        <section className="confirmation-hero"><span className="eyebrow">RESERVATION SNAPSHOT</span><div><h1>竞技区 {demo.selectedSeat}</h1><StatusPill tone="cyan">{demo.bookingMode === "immediate" ? "立即预约" : "未来时段"}</StatusPill></div><p>{store.name} · {machine.name} · {machine.spec}</p><div className="confirmation-time"><Clock size={21} /><span><strong>{dateProfile(demo.selectedDate).longLabel} {formatTimeRange(demo.startMinutes, demo.durationHours)}</strong><small>{demo.durationHours} 小时 · 上海时间</small></span></div></section>
        <Section title="模拟金额">
          <div className="money-summary"><div><span>{quote.segments.length} 个半小时价格片段</span><strong>¥{quote.subtotal.toFixed(2)}</strong></div><div><span>预约立减体验券</span><strong className="lime-text">{demo.reservationCoupon ? `−¥${quote.discount.toFixed(2)}` : "未使用"}</strong></div><div className="total"><span>应付模拟金额</span><strong>¥{payable.toFixed(2)}</strong></div></div>
          <button className="expand-row" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>半小时价格明细<span>{expanded ? "收起" : "展开"}<CaretRight className={expanded ? "rotate" : ""} size={17} /></span></button>
          {expanded ? <div className="price-segments">{quote.segments.map((segment) => <div key={segment.label}><span>{segment.label}<small>{segment.rule}</small></span><strong>¥{segment.amount.toFixed(2)}</strong></div>)}</div> : null}
        </Section>
        <Section title="体验券">
          <button className={demo.reservationCoupon ? "coupon active" : "coupon"} type="button" onClick={() => demo.setReservationCoupon(!demo.reservationCoupon)}><Ticket size={24} weight="fill" /><span><strong>预约立减体验券 · ¥6</strong><small>{store.name} · 预约业务 · 08月15日前有效</small></span>{demo.reservationCoupon ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}</button>
        </Section>
        <Notice tone="info" icon={ShieldCheck} title="模拟支付不会扣款">
          确认后只在本机生成预约、价格和体验券快照，不调用真实支付。
        </Notice>
      </main>
    </MobileScroll>
  );
}

function ReservationPaymentScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [phase, setPhase] = useState<"confirm" | "processing" | "success" | "error">("confirm");
  const store = storeProfiles[demo.selectedStore];
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const payable = demo.reservationCoupon ? quote.total : quote.subtotal;
  const pay = () => {
    setPhase("processing");
    window.setTimeout(() => { demo.setReservationStatus("confirmed"); setPhase("success"); }, 900);
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="result-screen" data-screen-id="MP-08">
        <div className={`result-icon ${phase}`}>
          {phase === "processing" ? <ArrowClockwise className="spin" size={40} /> : phase === "success" ? <CheckCircle size={44} weight="fill" /> : phase === "error" ? <X size={40} weight="bold" /> : <ShieldCheck size={44} weight="fill" />}
        </div>
        <span className="eyebrow">SIMULATED PAYMENT</span>
        <h1>{phase === "confirm" ? "确认模拟支付" : phase === "processing" ? "正在写入本地沙箱" : phase === "success" ? "预约已确认" : "本地写入失败"}</h1>
        <p>{phase === "confirm" ? "本次不会扣款，也不会发起微信支付。" : phase === "processing" ? "请勿重复提交，结果只会生成一次。" : phase === "success" ? "价格与体验券结果已形成快照。" : "没有显示业务成功，当前输入仍保留。"}</p>
        <div className="payment-amount"><span>模拟金额</span><strong>¥{payable.toFixed(2)}</strong></div>
        <div className="payment-summary"><span>{store.name} · 竞技区 {demo.selectedSeat}</span><span>{dateProfile(demo.selectedDate).longLabel} {formatTimeRange(demo.startMinutes, demo.durationHours)}</span><span>{demo.reservationCoupon ? `预约立减体验券 −¥${quote.discount.toFixed(2)}` : "未使用预约体验券"}</span></div>
        {phase === "confirm" ? <PrimaryButton onClick={pay}>确认模拟支付（不扣款）</PrimaryButton> : null}
        {phase === "processing" ? <PrimaryButton disabled>处理中…</PrimaryButton> : null}
        {phase === "success" ? <PrimaryButton onClick={() => flow.replace(reservationDetailScreen())}>查看预约详情</PrimaryButton> : null}
        {phase === "error" ? <PrimaryButton onClick={pay}>重试写入</PrimaryButton> : null}
        {phase === "confirm" ? <button className="text-link centered" type="button" onClick={() => setPhase("error")}>查看失败恢复状态稿</button> : null}
      </main>
    </MobileScroll>
  );
}

function ReservationDetailScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [cancelOpen, setCancelOpen] = useState(false);
  const store = storeProfiles[demo.selectedStore];
  const machine = machineProfiles[demo.machineId];
  const quote = reservationQuote(demo.machineId, demo.selectedDate, demo.startMinutes, demo.durationHours);
  const paidAmount = demo.reservationCoupon ? quote.total : quote.subtotal;
  const status = demo.reservationStatus === "none" ? "confirmed" : demo.reservationStatus;
  const statusMeta: Record<ReservationStatus, { label: string; tone: "lime" | "cyan" | "amber" | "red" | "neutral"; title: string; note: string }> = {
    none: { label: "无预约", tone: "neutral", title: "没有当前预约", note: "从首页开始一次预约。" },
    pending: { label: "待确认", tone: "amber", title: "09:42 内完成模拟支付", note: "超时后座位和体验券会释放。" },
    confirmed: { label: "已确认", tone: "cyan", title: "到店窗口 19:10–19:45", note: "等待门店侧合成事件推进。" },
    arrived: { label: "已到店", tone: "cyan", title: "已到店，等待开始使用", note: "现在可购买本店柜台商品。" },
    active: { label: "使用中", tone: "lime", title: "剩余使用时间 01:59:45", note: "商品与座位报修仅在当前预约内出现。" },
    completed: { label: "已完成", tone: "neutral", title: "本次预约已完成", note: "最终成长值 +30，业务记录不可编辑。" },
    cancelled: { label: "已取消", tone: "red", title: "预约已取消", note: "模拟退款 ¥30.00，体验券已释放。" },
    expired: { label: "已过期", tone: "red", title: "待确认超时", note: "座位与体验券占用已经释放。" },
  };
  const meta = statusMeta[status];
  const advance = () => {
    if (status === "confirmed") demo.setReservationStatus("arrived");
    else if (status === "arrived") demo.setReservationStatus("active");
    else if (status === "active") demo.setReservationStatus("completed");
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content reservation-detail" data-screen-id="MP-09">
        <section className="status-hero"><div><StatusPill tone={meta.tone}>{meta.label}</StatusPill><h1>{meta.title}</h1><p>{meta.note}</p></div><Armchair size={48} /></section>
        <StepRail labels={["已确认", "已到店", "使用中"]} active={status === "confirmed" ? 0 : status === "arrived" ? 1 : 2} />
        <div className="field-group compact-fields">
          <FieldRow icon={Storefront} label="门店" value={store.name} />
          <FieldRow icon={Armchair} label="座位" value={`竞技区 ${demo.selectedSeat}`} />
          <FieldRow icon={Monitor} label="机型" value={`${machine.name} · ${machine.spec}`} />
          <FieldRow icon={Clock} label="时段" value={`${dateProfile(demo.selectedDate).longLabel} ${formatTimeRange(demo.startMinutes, demo.durationHours)}`} />
          <FieldRow icon={CurrencyCny} label="模拟金额" value={`¥${paidAmount.toFixed(2)}`} />
        </div>
        {status === "active" || status === "arrived" ? (
          <Section title="预约内服务" action="上下文入口">
            <div className="context-actions">
              <button type="button" onClick={() => flow.push(productCatalogScreen())}><ShoppingBag size={23} /><span><strong>柜台商品</strong><small>仅本店取货</small></span><CaretRight size={18} /></button>
              {status === "active" ? <button type="button" onClick={() => flow.push(repairCreateScreen())}><Wrench size={23} /><span><strong>座位报修</strong><small>关联当前座位</small></span><CaretRight size={18} /></button> : null}
            </div>
          </Section>
        ) : null}
        {demo.orderStatus !== "none" || demo.repairStatus !== "none" ? (
          <Section title="关联记录"><div className="related-list">{demo.orderStatus !== "none" ? <button type="button" onClick={() => flow.push(orderDetailScreen())}><Receipt size={20} /><span>商品订单 · {demo.orderStatus}</span><CaretRight size={17} /></button> : null}{demo.repairStatus !== "none" ? <button type="button" onClick={() => flow.push(repairDetailScreen())}><Wrench size={20} /><span>报修单 · {demo.repairStatus}</span><CaretRight size={17} /></button> : null}</div></Section>
        ) : null}
        <Section title="业务事件">
          <Timeline events={[
            { time: "19:10", title: "预约已确认", note: "系统 · 演示数据" },
            { time: "19:12", title: "模拟支付成功", note: "价格与体验券快照已保存" },
            ...(status !== "confirmed" ? [{ time: "19:22", title: "已到店", note: "角色外演示工具推进" }] : []),
            ...(status === "active" || status === "completed" ? [{ time: "19:30", title: "开始使用", note: `竞技区 ${demo.selectedSeat}` }] : []),
            ...(status === "completed" ? [{ time: "21:05", title: "预约已完成", note: "无后续业务动作" }] : []),
          ]} />
        </Section>
        {status === "confirmed" || status === "arrived" || status === "active" ? (
          <Notice tone="warning" icon={Lightning} title="推进本地演示">
            仅推进本机合成故事，不代表顾客拥有门店员工权限。
          </Notice>
        ) : null}
        {status === "confirmed" || status === "arrived" || status === "active" ? <SecondaryButton onClick={advance}>{status === "confirmed" ? "推进到已到店" : status === "arrived" ? "推进到使用中" : "推进到预约完成"}</SecondaryButton> : <PrimaryButton onClick={() => flow.push(reservationConditionsScreen())}>再次预约</PrimaryButton>}
        {status === "confirmed" ? <button className="text-link centered danger-text" type="button" onClick={() => setCancelOpen(true)}>取消这条预约</button> : null}
      </main>
      <BottomSheet open={cancelOpen} onOpenChange={setCancelOpen} title="取消预约" description="RSV-260808-00123 · 棱镜旗舰店">
        <div className="sheet-stack"><Notice tone="warning" icon={Warning} title="取消影响">模拟金额 ¥30.00 会形成模拟退款；预约体验券将恢复为可用。</Notice><SecondaryButton danger onClick={() => { demo.setReservationStatus("cancelled"); setCancelOpen(false); }}>取消这条预约</SecondaryButton><SecondaryButton onClick={() => setCancelOpen(false)}>保留预约</SecondaryButton></div>
      </BottomSheet>
    </MobileScroll>
  );
}

function Section({ title, action, children }: { title: string; action?: string; children: ReactNode }) {
  return <section className="content-section"><div className="section-heading"><h2>{title}</h2>{action ? <span>{action}</span> : null}</div>{children}</section>;
}

function Timeline({ events }: { events: Array<{ time: string; title: string; note: string }> }) {
  return <div className="timeline">{events.map((event, index) => <div key={`${event.time}-${event.title}`}><span className={index === events.length - 1 ? "current" : "done"}>{index === events.length - 1 ? <Circle size={13} weight="fill" /> : <Check size={12} weight="bold" />}</span><time>{event.time}</time><p><strong>{event.title}</strong><small>{event.note}</small></p></div>)}</div>;
}

function ProductCatalogScreen() {
  const demo = useDemo();
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content product-content has-cart-footer" data-screen-id="MP-10">
        <Notice tone="success" icon={Armchair} title={`关联竞技区 ${demo.selectedSeat}`}>
          当前预约已到店或使用中，商品只支持棱镜旗舰店柜台整单取货。
        </Notice>
        <Carousel ariaLabel="商品分类" className="chip-carousel" contentClassName="chip-track"><button className="active" type="button">全部</button><button type="button">饮品</button><button type="button">零食</button><button type="button">便利用品</button></Carousel>
        <div className="catalog-list">
          {products.map((product) => {
            const Icon = product.icon;
            const quantity = demo.cart[product.id] ?? 0;
            return <article className="product-row" key={product.id}><div className="product-icon"><Icon size={27} weight="duotone" /></div><div className="product-copy"><h2>{product.name}</h2><p>{product.note}</p><span className={product.stock <= 3 ? "low-stock" : ""}>{product.stock <= 3 ? `仅余 ${product.stock}` : `可用 ${product.stock}`}</span></div><div className="product-control"><strong>¥{product.price.toFixed(2)}</strong><div className="quantity-control">{quantity > 0 ? <button type="button" onClick={() => demo.changeCart(product.id, -1)} aria-label={`减少${product.name}`}><Minus size={16} /></button> : null}{quantity > 0 ? <span>{quantity}</span> : null}<button type="button" onClick={() => demo.changeCart(product.id, 1)} aria-label={`增加${product.name}`}><Plus size={16} /></button></div></div></article>;
          })}
        </div>
        <Notice tone="info" icon={Package} title="整单库存校验">
          任一商品不足时整单不创建，购物车会保留以便调整。
        </Notice>
      </main>
    </MobileScroll>
  );
}

function cartSummary(cart: Record<string, number>) {
  const lines = products.filter((product) => (cart[product.id] ?? 0) > 0);
  const count = lines.reduce((sum, product) => sum + (cart[product.id] ?? 0), 0);
  const total = lines.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);
  return { lines, count, total };
}

function CartFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const summary = cartSummary(demo.cart);
  return <div className="cart-footer"><div><span>{summary.count} 件商品</span><strong>¥{summary.total.toFixed(2)}</strong></div><PrimaryButton onClick={() => flow.push(orderConfirmScreen())} disabled={summary.count === 0}>确认购物车</PrimaryButton></div>;
}

function OrderSubmitFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const summary = cartSummary(demo.cart);
  const amount = Math.max(0, summary.total - 5);
  return (
    <SingleActionFooter
      label="确认并模拟支付（不扣款）"
      sublabel={`应付模拟金额 ¥${amount.toFixed(2)}`}
      onClick={() => {
        demo.setOrderStatus("paid");
        flow.push(orderDetailScreen());
      }}
    />
  );
}

function OrderConfirmScreen() {
  const demo = useDemo();
  const summary = cartSummary(demo.cart);
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content has-fixed-footer" data-screen-id="MP-11">
        <Notice tone="success" icon={Storefront} title="棱镜旗舰店柜台取货">关联竞技区 {demo.selectedSeat}；整单商品会同时预留 10 分钟。</Notice>
        <Section title="商品快照"><div className="line-items">{summary.lines.map((product) => <div key={product.id}><span>{product.name}<small>× {demo.cart[product.id]}</small></span><strong>¥{(product.price * demo.cart[product.id]).toFixed(2)}</strong></div>)}</div></Section>
        <Section title="商品体验券"><button className="coupon active" type="button"><Ticket size={24} weight="fill" /><span><strong>商品立减体验券 · ¥5</strong><small>棱镜旗舰店 · 商品订单 · 本次可用</small></span><CheckCircle size={22} weight="fill" /></button></Section>
        <Section title="金额"><div className="money-summary"><div><span>商品合计</span><strong>¥{summary.total.toFixed(2)}</strong></div><div><span>商品体验券</span><strong className="lime-text">−¥5.00</strong></div><div className="total"><span>应付模拟金额</span><strong>¥{Math.max(0, summary.total - 5).toFixed(2)}</strong></div></div></Section>
        <Notice tone="info" icon={ShieldCheck} title="模拟支付不会扣款">确认后只在本机创建商品订单与库存预留。</Notice>
      </main>
    </MobileScroll>
  );
}

function OrderDetailScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  useEffect(() => { if (demo.orderStatus === "none") demo.setOrderStatus("paid"); }, []);
  const status = demo.orderStatus === "none" ? "paid" : demo.orderStatus;
  const summary = cartSummary(demo.cart);
  const paidAmount = Math.max(0, summary.total - 5);
  const progress = status === "paid" ? 1 : status === "making" ? 2 : status === "pickup" ? 3 : status === "completed" ? 4 : 0;
  const labels: Record<OrderStatus, string> = { none: "未创建", pending: "待模拟支付", paid: "已模拟支付", making: "制作中", pickup: "待取", completed: "已完成", cancelled: "已取消", expired: "已过期" };
  const advance = () => {
    if (status === "paid") demo.setOrderStatus("making");
    else if (status === "making") demo.setOrderStatus("pickup");
    else if (status === "pickup") demo.setOrderStatus("completed");
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content order-detail" data-screen-id="MP-12">
        <section className="status-hero"><div><StatusPill tone={status === "completed" ? "neutral" : status === "cancelled" || status === "expired" ? "red" : "lime"}>{labels[status]}</StatusPill><h1>{status === "pickup" ? "请前往柜台整单取货" : status === "making" ? "柜台正在准备商品" : status === "completed" ? "商品已全部领取" : "商品订单已保留"}</h1><p>棱镜旗舰店 · 关联竞技区 {demo.selectedSeat}</p></div><ShoppingBag size={47} /></section>
        <StepRail labels={["待支付", "已支付", "制作中", "待取", "完成"]} active={progress} />
        <Section title="商品明细"><div className="line-items">{summary.lines.map((product) => <div key={product.id}><span>{product.name}<small>× {demo.cart[product.id]}</small></span><strong>¥{(product.price * demo.cart[product.id]).toFixed(2)}</strong></div>)}<div className="total"><span>模拟支付金额</span><strong>¥{paidAmount.toFixed(2)}</strong></div></div></Section>
        <Section title="业务事件"><Timeline events={[{ time: "19:36", title: "商品库存已整单预留", note: "棱镜旗舰店" }, { time: "19:37", title: "模拟支付成功", note: "商品体验券已使用" }, ...(status === "making" || status === "pickup" || status === "completed" ? [{ time: "19:40", title: "开始制作", note: "取消入口已关闭" }] : []), ...(status === "pickup" || status === "completed" ? [{ time: "19:46", title: "全部商品待取", note: "请前往柜台" }] : []), ...(status === "completed" ? [{ time: "19:51", title: "订单已完成", note: `成长值 +${Math.round(paidAmount)}` }] : [])]} /></Section>
        {status === "paid" || status === "making" || status === "pickup" ? <><Notice tone="warning" icon={Lightning} title="推进本地演示">仅推进预置的合法商品履约结果，不代表顾客操作柜台。</Notice><SecondaryButton onClick={advance}>{status === "paid" ? "推进到制作中" : status === "making" ? "推进到待取" : "推进到已完成"}</SecondaryButton></> : <PrimaryButton onClick={() => flow.push(productCatalogScreen())}>再次购买</PrimaryButton>}
      </main>
    </MobileScroll>
  );
}

function RepairCreateScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content repair-create has-fixed-footer" data-screen-id="MP-13">
        <Notice tone="success" icon={Armchair} title={`当前座位 · 竞技区 ${demo.selectedSeat}`}>竞技型 · 2K / 180Hz · 预约使用中</Notice>
        <Section title="问题描述" action={`${demo.repairDescription.length}/500`}>
          <KeyboardTextarea value={demo.repairDescription} maxLength={500} onChange={(event) => demo.setRepairDescription(event.target.value)} aria-label="报修问题描述" />
          <p className="privacy-copy"><Lock size={16} />请勿填写真实姓名、电话或其他个人信息</p>
        </Section>
        <Section title="本地图片" action="可选 · 最多 3 张">
          {demo.repairPhoto ? <div className="photo-preview"><img src="/assets/repair-headset-sample.png" alt="耳机样例问题图" /><button type="button" onClick={() => demo.setRepairPhoto(false)} aria-label="删除样例图"><Trash size={18} /></button><span>样例图 · 仅本机保存</span></div> : <button className="upload-placeholder" type="button" onClick={() => flow.push(imagePickerScreen())}><ImageSquare size={29} /><span><strong>添加图片或使用样例图</strong><small>JPEG、PNG、WebP · 单张不超过 5 MB</small></span><CaretRight size={18} /></button>}
        </Section>
        <Notice tone="info" icon={CloudSlash} title="不会上传到 Web">图片只保存在当前设备的本地沙箱，拒绝权限也可以继续文字提交。</Notice>
      </main>
    </MobileScroll>
  );
}

function RepairSubmitFooter({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  return <SingleActionFooter label="提交座位报修" disabled={demo.repairDescription.trim().length === 0} onClick={() => { demo.setRepairStatus("new"); flow.replace(repairDetailScreen()); }} />;
}

function ImagePickerScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [permission, setPermission] = useState<"idle" | "denied">("idle");
  const useSample = () => { demo.setRepairPhoto(true); flow.pop(); };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content image-picker" data-screen-id="MP-14">
        <PageIntro eyebrow="LOCAL MEDIA" title="选择图片来源" description="图片为可选项，任何权限结果都不会阻断文字报修" />
        <div className="source-actions"><button type="button" onClick={() => setPermission("denied")}><Images size={26} /><span><strong>从相册选择</strong><small>演示权限拒绝回退</small></span><CaretRight size={18} /></button><button type="button" onClick={() => setPermission("denied")}><Camera size={26} /><span><strong>拍摄本地照片</strong><small>演示相机权限回退</small></span><CaretRight size={18} /></button></div>
        {permission === "denied" ? <Notice tone="warning" icon={Warning} title="未获得图片权限">图片不是必填项。你可以继续文字提交，或选择下方内置样例图。</Notice> : null}
        <Section title="内置样例图" action="不申请权限">
          <button className="sample-image-card" type="button" onClick={useSample}><img src="/assets/repair-headset-sample.png" alt="耳机右声道故障样例图" /><span><strong>耳机连接与右声道问题</strong><small>虚构设备照片 · 仅用于本地演示</small></span><CheckCircle size={22} /></button>
        </Section>
        <SecondaryButton onClick={flow.pop}>不添加图片，返回填写</SecondaryButton>
      </main>
    </MobileScroll>
  );
}

function RepairDetailScreen() {
  const demo = useDemo();
  const [verificationFailed, setVerificationFailed] = useState(false);
  const status = demo.repairStatus === "none" ? "new" : demo.repairStatus;
  const labels: Record<RepairStatus, string> = { none: "未创建", new: "新建", assigned: "已分派", processing: "处理中", verification: "待验证", closed: "已关闭" };
  const step = status === "new" ? 0 : status === "assigned" ? 1 : status === "processing" ? 2 : status === "verification" ? 3 : 4;
  const advance = () => {
    if (status === "new") demo.setRepairStatus("assigned");
    else if (status === "assigned") demo.setRepairStatus("processing");
    else if (status === "processing") demo.setRepairStatus("verification");
  };
  const failVerification = () => {
    setVerificationFailed(true);
    demo.setRepairStatus("processing");
  };
  const closeRepair = () => demo.setRepairStatus("closed");
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content repair-detail" data-screen-id="MP-15">
        <section className="status-hero"><div><StatusPill tone={status === "closed" ? "neutral" : status === "processing" ? "amber" : "cyan"}>{labels[status]}</StatusPill><h1>{status === "processing" ? verificationFailed ? "验证未通过，门店继续处理" : "座位已进入维护处理" : status === "verification" ? "维修结果等待独立验证" : status === "closed" ? "故障验证完成，座位已恢复" : "报修已提交，等待公开进度"}</h1><p>竞技区 {demo.selectedSeat} · 竞技型</p></div><Wrench size={46} /></section>
        <StepRail labels={["新建", "分派", "处理", "验证", "关闭"]} active={step} />
        <Section title="顾客描述"><div className="issue-copy"><Headphones size={23} /><p>{demo.repairDescription}<small>请勿补充真实个人信息</small></p></div>{demo.repairPhoto ? <img className="repair-detail-photo" src="/assets/repair-headset-sample.png" alt="报修样例图" /> : null}</Section>
        {status === "processing" || status === "verification" || status === "closed" ? <Notice tone="warning" icon={CurrencyCny} title="设备中断影响">当前不足半小时片段照常计费，未来完整片段形成模拟退款 ¥18.00。</Notice> : null}
        {step >= 3 || verificationFailed ? <Section title="公开解决结果"><div className="issue-copy"><CheckCircle size={23} /><p>已更换无品牌备用耳机并完成左右声道测试。<small>仅展示门店公开说明，不含处理人、内部备注或备件数量</small></p></div></Section> : null}
        {verificationFailed && status === "processing" ? <Notice tone="warning" icon={Warning} title="验证未通过，已退回处理中">公开原因：复测仍存在右声道无声；座位继续保持维护。</Notice> : null}
        <Section title="公开处理动态"><Timeline events={[{ time: "19:42", title: "报修单已创建", note: "等待门店分派" }, ...(step >= 1 || verificationFailed ? [{ time: "19:44", title: "已安排处理", note: "公开说明：正在检查耳机连接" }] : []), ...(step >= 2 || verificationFailed ? [{ time: "19:48", title: "处理中", note: "座位暂时标记为维护中" }] : []), ...(verificationFailed ? [{ time: "19:59", title: "验证未通过", note: "公开说明：门店将继续处理" }] : []), ...(step >= 3 ? [{ time: verificationFailed ? "20:06" : "19:57", title: "等待验证", note: "公开说明：维修结果已重新提交" }] : []), ...(step >= 4 ? [{ time: "20:12", title: "验证成功并关闭", note: "座位恢复可用" }] : [])]} /></Section>
        {status !== "closed" ? <><Notice tone="warning" icon={Lightning} title="推进本地演示">只触发预置的公开维修结果，不展示处理人、内部备注或备件成本。</Notice>{status === "verification" ? <div className="repair-demo-actions"><SecondaryButton danger onClick={failVerification}>演示验证失败并退回</SecondaryButton><PrimaryButton onClick={closeRepair}>演示验证成功并关闭</PrimaryButton></div> : <SecondaryButton onClick={advance}>{status === "new" ? "推进到已分派" : status === "assigned" ? "推进到处理中" : "重新提交并进入待验证"}</SecondaryButton>}</> : <Notice tone="success" icon={CheckCircle} title="公开结果已完整">故障验证成功；座位已恢复可用，模拟退款与预约影响已写入统一历史。</Notice>}
      </main>
    </MobileScroll>
  );
}

function TripsScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [tab, setTab] = useState<"current" | "future" | "history">("current");
  const orderSummary = cartSummary(demo.cart);
  const orderAmount = Math.max(0, orderSummary.total - 5);
  const orderTitle = orderSummary.lines.map((product) => product.name).join("、");
  const currentReservation = ["pending", "confirmed", "arrived", "active"].includes(demo.reservationStatus);
  const currentOrder = ["pending", "paid", "making", "pickup"].includes(demo.orderStatus);
  const currentRepair = ["new", "assigned", "processing", "verification"].includes(demo.repairStatus);
  const hasCurrentJourney = currentReservation || currentOrder || currentRepair;
  const historicalReservation = ["completed", "cancelled", "expired"].includes(demo.reservationStatus);
  const historicalOrder = ["completed", "cancelled", "expired"].includes(demo.orderStatus);
  const hasHistoricalJourney = historicalReservation || historicalOrder || demo.repairStatus === "closed";
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="root-content trips-screen" data-screen-id="MP-16">
        <div className="root-title"><div><span className="eyebrow">UNIFIED JOURNEY</span><h1>行程</h1></div><button className="icon-button" type="button" onClick={() => flow.push(screenIndexScreen())} aria-label="设计稿索引"><ClipboardText size={21} /></button></div>
        <LocalDemoStrip flow={flow} compact />
        <div className="tab-row"><button className={tab === "current" ? "active" : ""} type="button" onClick={() => setTab("current")}>当前</button><button className={tab === "future" ? "active" : ""} type="button" onClick={() => setTab("future")}>未来</button><button className={tab === "history" ? "active" : ""} type="button" onClick={() => setTab("history")}>历史</button></div>
        {tab === "current" ? (
          hasCurrentJourney ? <div className="journey-stack">{currentReservation ? <JourneyCard icon={Armchair} label="预约" title={`棱镜旗舰店 · ${demo.selectedSeat}`} status={demo.reservationStatus} meta="今天 19:30–21:30" onClick={() => flow.push(reservationDetailScreen())} /> : null}{currentOrder ? <JourneyCard icon={ShoppingBag} label="商品订单" title={orderTitle || "柜台商品"} status={demo.orderStatus} meta={`模拟金额 ¥${orderAmount.toFixed(2)}`} onClick={() => flow.push(orderDetailScreen())} /> : null}{currentRepair ? <JourneyCard icon={Wrench} label="报修" title="耳机右声道无声" status={demo.repairStatus} meta={`关联竞技区 ${demo.selectedSeat}`} onClick={() => flow.push(repairDetailScreen())} /> : null}</div> : <EmptyState icon={CalendarBlank} title="还没有当前预约" description="从首页选择门店、时段、机型和明确座位。"><PrimaryButton onClick={() => flow.replace(rootScreen("home"))}>开始预约</PrimaryButton></EmptyState>
        ) : null}
        {tab === "future" ? <div className="journey-stack"><JourneyCard icon={CalendarBlank} label="未来预约" title="星桥标准店 · B-07" status="已确认" meta="08月10日 20:00–22:00" onClick={() => flow.push(reservationDetailScreen())} /></div> : null}
        {tab === "history" ? hasHistoricalJourney ? <div className="journey-stack">{historicalReservation ? <JourneyCard icon={CheckCircle} label="已结束预约" title={`棱镜旗舰店 · ${demo.selectedSeat}`} status={demo.reservationStatus} meta="08月06日 18:00–20:00" onClick={() => flow.push(reservationDetailScreen())} /> : null}{historicalOrder ? <JourneyCard icon={ShoppingBag} label="已结束商品订单" title={orderTitle || "柜台商品"} status={demo.orderStatus} meta={`最终模拟金额 ¥${orderAmount.toFixed(2)}`} onClick={() => flow.push(orderDetailScreen())} /> : null}{demo.repairStatus === "closed" ? <JourneyCard icon={CurrencyCny} label="模拟退款" title="设备中断退款" status="已完成" meta="¥18.00 · 关联报修 RPR-0042" onClick={() => flow.push(repairDetailScreen())} /> : null}</div> : <EmptyState icon={CalendarBlank} title="还没有历史行程" description="完成或结束的预约、订单、报修与模拟退款会聚合在这里。"><PrimaryButton onClick={() => flow.replace(rootScreen("home"))}>开始预约</PrimaryButton></EmptyState> : null}
      </main>
    </MobileScroll>
  );
}

function JourneyCard({ icon: Icon, label, title, status, meta, onClick }: { icon: IconComponent; label: string; title: string; status: string; meta: string; onClick: () => void }) {
  return <button className="journey-card" type="button" onClick={onClick}><div className="journey-icon"><Icon size={24} /></div><div><small>{label}</small><strong>{title}</strong><span>{meta}</span></div><div className="journey-status"><StatusPill tone="cyan">{status}</StatusPill><CaretRight size={17} /></div></button>;
}

function EmptyState({ icon: Icon, title, description, children }: { icon: IconComponent; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div><Icon size={36} /></div><h2>{title}</h2><p>{description}</p>{children}</div>;
}

function MemberScreen({ flow }: { flow: FlowControls }) {
  type CouponTab = "可用" | "占用中" | "已使用" | "已过期";
  const [couponTab, setCouponTab] = useState<CouponTab>("可用");
  const coupons: Record<CouponTab, Array<{ title: string; note: string; tone: "cyan" | "lime" | "neutral"; action?: () => void }>> = {
    可用: [
      { title: "预约立减体验券 · ¥6", note: "棱镜旗舰店 · 满 ¥20 可用 · 08月31日前有效", tone: "lime", action: () => flow.push(reservationConditionsScreen()) },
      { title: "商品立减体验券 · ¥5", note: "三店商品订单 · 满 ¥15 可用 · 08月31日前有效", tone: "lime", action: () => flow.push(productCatalogScreen()) },
    ],
    占用中: [
      { title: "预约立减体验券 · ¥6", note: "关联待确认预约 · 保留过期后恢复可用", tone: "cyan", action: () => flow.push(reservationDetailScreen()) },
    ],
    已使用: [
      { title: "历史预约体验券 · ¥6", note: "关联已完成预约 · 开始使用后不再恢复", tone: "neutral", action: () => flow.push(reservationDetailScreen()) },
    ],
    已过期: [
      { title: "历史商品体验券 · ¥3", note: "有效期已结束 · 未占用任何交易", tone: "neutral" },
    ],
  };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="root-content member-screen" data-screen-id="MP-17">
        <div className="root-title"><div><span className="eyebrow">MEMBER PROFILE</span><h1>会员</h1></div><button className="icon-button" type="button" onClick={() => flow.push(settingsScreen())} aria-label="本地演示设置"><GearSix size={21} /></button></div>
        <LocalDemoStrip flow={flow} compact />
        <section className="member-hero"><div className="member-medal"><Star size={28} weight="fill" /></div><div><span>白银会员 · 虚构人物</span><h2>林澈</h2><p>终身不降级 · 距离黄金还差 640 成长值</p></div><strong>860</strong></section>
        <div className="growth-progress"><div><span>白银 500</span><span>黄金 1500</span></div><progress value="860" max="1500" aria-label="成长值 860 / 1500" /><small>完成预约按体验券减免后的最终模拟金额每满一元获得一点成长值</small></div>
        <Section title="体验券">
          <div className="tab-row compact-tabs">{(["可用", "占用中", "已使用", "已过期"] as const).map((item) => <button className={couponTab === item ? "active" : ""} type="button" key={item} onClick={() => setCouponTab(item)}>{item}</button>)}</div>
          <div className="coupon-stack">{coupons[couponTab].map((coupon) => coupon.action ? <button className="coupon display" key={coupon.title} type="button" onClick={coupon.action}><Ticket size={25} weight="fill" /><span><strong>{coupon.title}</strong><small>{coupon.note}</small></span><StatusPill tone={coupon.tone}>{couponTab}</StatusPill></button> : <div className="coupon display" key={coupon.title}><Ticket size={25} weight="fill" /><span><strong>{coupon.title}</strong><small>{coupon.note}</small></span><StatusPill tone={coupon.tone}>{couponTab}</StatusPill></div>)}</div>
        </Section>
        <Section title="成长记录"><div className="growth-list"><button type="button" onClick={() => flow.push(reservationDetailScreen())}><TrendUp size={19} /><span><strong>完成预约 · 最终模拟金额 ¥24</strong><small>08月06日 · 棱镜旗舰店 · 点击查看关联预约</small></span><b>+24</b></button><div><TrendUp size={19} /><span><strong>标准故事起始累计成长</strong><small>终身累计只增不减</small></span><b>+836</b></div></div></Section>
      </main>
    </MobileScroll>
  );
}

function GuideScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const steps = [
    { title: "选择预约条件", note: "门店、日期、时段、机型", done: demo.reservationStatus !== "none" },
    { title: "选择明确座位", note: `当前工作座位 ${demo.selectedSeat}`, done: demo.reservationStatus !== "none" },
    { title: "完成模拟支付", note: "不会扣款", done: ["confirmed", "arrived", "active", "completed"].includes(demo.reservationStatus) },
    { title: "查看预约进度", note: "到店与使用中", done: ["arrived", "active", "completed"].includes(demo.reservationStatus) },
    { title: "购买柜台商品", note: "整单库存校验", done: demo.orderStatus !== "none" },
    { title: "提交座位报修", note: "公开动态与模拟退款", done: demo.repairStatus !== "none" },
    { title: "查看历史与重置", note: "统一行程和本地设置", done: false },
  ];
  const current = Math.max(0, steps.findIndex((step) => !step.done));
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content guide-screen" data-screen-id="MP-02">
        <PageIntro eyebrow={`步骤 ${current + 1}/7`} title={steps[current]?.title ?? "主演示已完成"} description="引导进度由本机业务记录推导，不伪造顾客权限" />
        <div className="guide-list">{steps.map((step, index) => <div className={step.done ? "done" : index === current ? "current" : ""} key={step.title}><span>{step.done ? <Check size={15} weight="bold" /> : index + 1}</span><p><strong>{step.title}</strong><small>{step.note}</small></p>{index === current ? <StatusPill tone="lime">当前</StatusPill> : null}</div>)}</div>
        <Notice tone="info" icon={Info} title="主演示不是权限入口">“推进本地演示”只触发预置的门店侧结果，正常顾客区不会出现员工操作。</Notice>
        <PrimaryButton onClick={() => flow.push(current < 2 ? reservationConditionsScreen() : current < 4 ? reservationDetailScreen() : current === 4 ? productCatalogScreen() : current === 5 ? repairCreateScreen() : rootScreen("trips"))}>继续当前步骤</PrimaryButton>
        <SecondaryButton onClick={() => flow.push(screenIndexScreen())}>打开设计稿索引</SecondaryButton>
      </main>
    </MobileScroll>
  );
}

function SettingsScreen({ flow }: { flow: FlowControls }) {
  const demo = useDemo();
  const [resetOpen, setResetOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const reset = () => { demo.reset(); setResetOpen(false); setSuccess(true); window.localStorage.setItem("jingshu-mini-intro-seen", "true"); };
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content settings-screen" data-screen-id="MP-18">
        {success ? <Notice tone="success" icon={CheckCircle} title="本地演示已重置">预约、订单、报修、成长值与引导进度已恢复到标准故事。</Notice> : null}
        <Section title="本地沙箱"><div className="settings-list"><FieldRow icon={HardDrive} label="保存位置" value="当前设备本地沙箱" /><FieldRow icon={Database} label="schema 版本" value="v1.0 · 当前" /><FieldRow icon={ClipboardText} label="标准种子" value="seed-2026.08" /><FieldRow icon={CloudSlash} label="跨端状态" value="不与 Web 同步" /></div></Section>
        <Section title="恢复与迁移"><div className="settings-list"><button className="field-row" type="button" onClick={() => flow.push(systemStateScreen())}><ArrowClockwise size={22} /><span className="field-copy"><small>迁移与失败状态</small><strong>查看恢复设计稿</strong></span><CaretRight size={18} /></button></div></Section>
        <Notice tone="warning" icon={Warning} title="重置只影响当前设备">不会影响 Web 沙箱或其他体验者，也无法撤销本机演示记录清除。</Notice>
        <SecondaryButton danger onClick={() => setResetOpen(true)}><Trash size={19} />重置本地演示</SecondaryButton>
        <PrimaryButton onClick={() => flow.replace(rootScreen("home"))}>回到预约首页</PrimaryButton>
      </main>
      <BottomSheet open={resetOpen} onOpenChange={setResetOpen} title="重置本地演示" description="此操作只影响当前设备">
        <div className="sheet-stack"><Notice tone="danger" icon={Trash} title="将恢复到标准故事">预约、商品订单、报修、会员成长值和引导进度都会被清除并重建。</Notice><SecondaryButton danger onClick={reset}>清除并重建本地演示</SecondaryButton><SecondaryButton onClick={() => setResetOpen(false)}>保留当前故事</SecondaryButton></div>
      </BottomSheet>
    </MobileScroll>
  );
}

function SystemStateScreen() {
  const [state, setState] = useState<"storage" | "migration" | "conflict" | "permission" | "loading" | "empty">("storage");
  const stateMeta = {
    storage: { icon: HardDrive, tone: "danger" as const, title: "本地存储写入失败", copy: "没有显示预约成功，当前选择和输入仍然保留。", action: "重试写入" },
    migration: { icon: Database, tone: "warning" as const, title: "本地数据迁移失败", copy: "已阻止进入部分可写状态，可重试迁移或确认重建。", action: "重试迁移" },
    conflict: { icon: Armchair, tone: "warning" as const, title: "A-18 已不可订", copy: "其他预约条件已保留，请返回座位图重新选择。", action: "重新选择座位" },
    permission: { icon: ImageSquare, tone: "info" as const, title: "未获得图片权限", copy: "图片为可选项，可以继续文字提交或使用内置样例图。", action: "继续文字提交" },
    loading: { icon: ArrowClockwise, tone: "info" as const, title: "正在处理同一请求", copy: "主操作已锁定，不会重复创建预约、订单或报修单。", action: "处理中…" },
    empty: { icon: CalendarBlank, tone: "info" as const, title: "暂无行程记录", copy: "完成一次预约后，关联订单、报修和模拟退款会聚合在这里。", action: "开始预约" },
  }[state];
  const Icon = stateMeta.icon;
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content system-state-screen" data-screen-id="MP-19">
        <PageIntro eyebrow="RECOVERY STATES" title="通用系统状态" description="安全错误信息、恢复动作与空状态的统一设计" />
        <Carousel ariaLabel="系统状态类型" className="chip-carousel" contentClassName="chip-track">{(["storage", "migration", "conflict", "permission", "loading", "empty"] as const).map((item) => <button className={state === item ? "active" : ""} type="button" key={item} onClick={() => setState(item)}>{{ storage: "存储", migration: "迁移", conflict: "冲突", permission: "权限", loading: "处理中", empty: "空状态" }[item]}</button>)}</Carousel>
        <div className={`state-stage ${stateMeta.tone}`}><div><Icon className={state === "loading" ? "spin" : ""} size={42} /></div><StatusPill tone={stateMeta.tone === "danger" ? "red" : stateMeta.tone === "warning" ? "amber" : "cyan"}>可恢复</StatusPill><h2>{stateMeta.title}</h2><p>{stateMeta.copy}</p><PrimaryButton disabled={state === "loading"}>{stateMeta.action}</PrimaryButton><SecondaryButton>返回安全页面</SecondaryButton></div>
        <Notice tone="info" icon={ShieldCheck} title="安全文案规则">不展示堆栈、内部路径或技术对象名；不以伪成功覆盖真实失败。</Notice>
      </main>
    </MobileScroll>
  );
}

function ScreenIndexScreen({ flow }: { flow: FlowControls }) {
  const entries = [
    ["MP-00", "本地沙箱启动"], ["MP-01", "预约优先首页"], ["MP-02", "演示引导"], ["MP-03", "门店列表"], ["MP-04", "门店详情"], ["MP-05", "预约条件"], ["MP-06", "座位图"], ["MP-07", "预约确认"], ["MP-08", "预约模拟支付"], ["MP-09", "预约详情"], ["MP-10", "商品目录与购物车"], ["MP-11", "订单确认与模拟支付"], ["MP-12", "订单详情"], ["MP-13", "创建报修"], ["MP-14", "图片选择与回退"], ["MP-15", "报修详情"], ["MP-16", "行程中心"], ["MP-17", "会员中心"], ["MP-18", "本地演示设置"], ["MP-19", "通用系统状态"],
  ];
  return (
    <MobileScroll className="app-screen app-dark">
      <main className="detail-content screen-index" data-screen-id="INDEX">
        <Notice tone="info" icon={ClipboardText} title="设计审阅入口">这些编号只用于原型审阅，不属于正式顾客导航。</Notice>
        <div className="index-list">{entries.map(([id, label]) => <button key={id} type="button" onClick={() => flow.push(screenForId(id))}><span>{id}</span><strong>{label}</strong><CaretRight size={18} /></button>)}</div>
      </main>
    </MobileScroll>
  );
}
