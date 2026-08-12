import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrototypeHref,
  createPrototypeRouter,
  parsePrototypeLocation,
  prototypeQaSearch,
  shouldHandlePrototypeLink,
} from "../src/router.js";

function fakeBrowser(initialHref) {
  let current = new URL(initialHref);
  const listeners = new Map();
  const calls = [];
  const history = {
    pushState(_state, _title, href) {
      calls.push(["push", href]);
      current = new URL(href, current);
    },
    replaceState(_state, _title, href) {
      calls.push(["replace", href]);
      current = new URL(href, current);
    },
  };

  return {
    calls,
    history,
    get location() {
      return current;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    visit(href) {
      current = new URL(href, current);
      listeners.get("popstate")?.();
    },
  };
}

test("parses the tracer routes and their canonical page metadata", () => {
  assert.deepEqual(
    ["/staff/workbench", "/staff/orders/all"].map((pathname) => {
      const route = parsePrototypeLocation({ pathname, search: "" });
      return [route.key, route.role, route.page, route.tab, route.heading];
    }),
    [
      ["staff.workbench", "staff", "workbench", null, "工作台"],
      ["staff.orders.all", "staff", "orders", "all", "商品订单"],
    ],
  );
});

test("replaces parent paths with their explicit default route", () => {
  for (const [pathname, expected] of [
    ["/staff", "/staff/workbench"],
    ["/staff/orders/", "/staff/orders/all"],
  ]) {
    const route = parsePrototypeLocation({ pathname, search: "" });
    assert.equal(route.needsReplace, true);
    assert.equal(route.canonicalHref, expected);
  }
});

test("keeps only prototype QA parameters during route generation", () => {
  const search =
    "?demoStep=6&sandboxState=readonly&businessTime=20%3A30&role=hq&storeCode=evil";
  assert.equal(
    prototypeQaSearch(search),
    "?demoStep=6&sandboxState=readonly&businessTime=20%3A30",
  );
  assert.equal(
    buildPrototypeHref("staff.orders.all", search),
    "/staff/orders/all?demoStep=6&sandboxState=readonly&businessTime=20%3A30",
  );
});

test("encapsulates push, replace and popstate recovery", () => {
  const browser = fakeBrowser(
    "https://example.test/staff?demoStep=6&permission=admin",
  );
  const router = createPrototypeRouter(browser);
  const observed = [];
  const stop = router.start((route) => observed.push(route.key));

  assert.deepEqual(browser.calls, [
    ["replace", "/staff/workbench?demoStep=6"],
  ]);

  router.navigate("staff.orders.all");
  assert.deepEqual(browser.calls.at(-1), [
    "push",
    "/staff/orders/all?demoStep=6",
  ]);

  browser.visit("/staff/workbench?demoStep=6");
  assert.deepEqual(observed, [
    "staff.workbench",
    "staff.orders.all",
    "staff.workbench",
  ]);
  stop();
});

test("only intercepts an unmodified primary-button link activation", () => {
  const base = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
  };
  assert.equal(shouldHandlePrototypeLink(base), true);
  assert.equal(shouldHandlePrototypeLink({ ...base, metaKey: true }), false);
  assert.equal(shouldHandlePrototypeLink({ ...base, button: 1 }), false);
});
