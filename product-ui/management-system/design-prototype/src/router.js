export const PROTOTYPE_QA_PARAMS = Object.freeze([
  "attendanceResult",
  "attendanceState",
  "businessTime",
  "demoStep",
  "handoverState",
  "orderCommandState",
  "resetState",
  "sandboxState",
  "timeState",
]);

const qaParamSet = new Set(PROTOTYPE_QA_PARAMS);

export const prototypeRoutes = Object.freeze({
  "staff.workbench": Object.freeze({
    key: "staff.workbench",
    path: "/staff/workbench",
    role: "staff",
    page: "workbench",
    tab: null,
    title: "工作台｜棱镜场馆演示",
    heading: "工作台",
  }),
  "staff.orders.all": Object.freeze({
    key: "staff.orders.all",
    path: "/staff/orders/all",
    role: "staff",
    page: "orders",
    tab: "all",
    title: "商品订单｜棱镜场馆演示",
    heading: "商品订单",
  }),
});

const routeByPath = new Map(
  Object.values(prototypeRoutes).map((route) => [route.path, route]),
);

const parentDefaults = new Map([
  ["/staff", "staff.workbench"],
  ["/staff/orders", "staff.orders.all"],
]);

function normalizedPathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  const normalized = pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function prototypeQaSearch(search = "") {
  const source = new URLSearchParams(search);
  const allowed = new URLSearchParams();

  for (const [key, value] of source) {
    if (qaParamSet.has(key)) allowed.append(key, value);
  }

  const result = allowed.toString();
  return result ? `?${result}` : "";
}

export function buildPrototypeHref(routeKey, search = "") {
  const route = prototypeRoutes[routeKey];
  if (!route) throw new Error(`Unknown prototype route: ${routeKey}`);
  return `${route.path}${prototypeQaSearch(search)}`;
}

export function parsePrototypeLocation(location) {
  const pathname = normalizedPathname(location.pathname);
  const qaSearch = prototypeQaSearch(location.search);
  const defaultRouteKey = parentDefaults.get(pathname);
  const route = defaultRouteKey
    ? prototypeRoutes[defaultRouteKey]
    : routeByPath.get(pathname) ?? null;
  const canonicalHref = route
    ? buildPrototypeHref(route.key, qaSearch)
    : `${pathname}${qaSearch}`;
  const currentHref = `${location.pathname || "/"}${location.search || ""}`;

  return Object.freeze({
    ...route,
    matched: Boolean(route),
    pathname,
    qa: new URLSearchParams(qaSearch),
    qaSearch,
    canonicalHref,
    needsReplace: Boolean(route) && canonicalHref !== currentHref,
  });
}

export function shouldHandlePrototypeLink(event) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function createPrototypeRouter(browserWindow) {
  const listeners = new Set();

  function read() {
    return parsePrototypeLocation(browserWindow.location);
  }

  function emit(route = read()) {
    for (const listener of listeners) listener(route);
    return route;
  }

  function replaceCanonical(route) {
    if (!route.needsReplace) return route;
    browserWindow.history.replaceState(null, "", route.canonicalHref);
    return read();
  }

  function handlePopState() {
    emit(replaceCanonical(read()));
  }

  return Object.freeze({
    read,
    href(routeKey) {
      return buildPrototypeHref(routeKey, browserWindow.location.search);
    },
    start(listener) {
      listeners.add(listener);
      browserWindow.addEventListener("popstate", handlePopState);
      listener(replaceCanonical(read()));

      return () => {
        listeners.delete(listener);
        browserWindow.removeEventListener("popstate", handlePopState);
      };
    },
    navigate(routeKey, { replace = false } = {}) {
      const href = buildPrototypeHref(
        routeKey,
        browserWindow.location.search,
      );
      browserWindow.history[replace ? "replaceState" : "pushState"](
        null,
        "",
        href,
      );
      return emit();
    },
    leaveTracer({ replace = false } = {}) {
      const href = `/${prototypeQaSearch(browserWindow.location.search)}`;
      browserWindow.history[replace ? "replaceState" : "pushState"](
        null,
        "",
        href,
      );
      return emit();
    },
    handleLink(event, routeKey) {
      if (!shouldHandlePrototypeLink(event)) return false;
      event.preventDefault();
      this.navigate(routeKey);
      return true;
    },
  });
}
