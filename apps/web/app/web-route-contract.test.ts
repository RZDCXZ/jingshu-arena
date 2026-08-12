import { describe, expect, it } from "vitest";

import {
  buildWebPath,
  parseWebRoute,
  roleHomePath,
  WEB_QUERY_ORDER,
  WEB_ROUTE_MANIFEST,
  webRouteMetadata,
} from "./web-route-contract";

describe("Web route contract", () => {
  it("generates the approved role roots and explicit default homes", () => {
    expect(buildWebPath("customer-root")).toBe("/customer");
    expect(buildWebPath("staff-root")).toBe("/staff");
    expect(buildWebPath("manager-root")).toBe("/manager");
    expect(buildWebPath("hq-root")).toBe("/hq");

    expect(roleHomePath("customer")).toBe("/customer/reservations");
    expect(roleHomePath("staff")).toBe("/staff/workbench");
    expect(roleHomePath("manager")).toBe("/manager/dashboard");
    expect(roleHomePath("hq")).toBe("/hq/dashboard");
  });

  it("generates static pages, stable tabs, object details, and encoded parameters", () => {
    expect(buildWebPath("staff-workbench")).toBe("/staff/workbench");
    expect(buildWebPath("staff-orders-ready-for-pickup")).toBe(
      "/staff/orders/ready-for-pickup",
    );
    expect(
      buildWebPath("staff-reservation-detail", {
        reservationId: "reservation/with space",
      }),
    ).toBe("/staff/reservations/reservation%2Fwith%20space");
    expect(
      buildWebPath("hq-store-products", { storeCode: "prism-flagship" }),
    ).toBe("/hq/stores/prism-flagship/products");
    expect(buildWebPath("customer-reservation-seats")).toBe(
      "/customer/reservations/new/seats",
    );
    expect(buildWebPath("customer-reservation-confirm")).toBe(
      "/customer/reservations/new/confirm",
    );
    expect(
      buildWebPath("customer-reservation-detail", {
        reservationId: "reservation with space",
      }),
    ).toBe("/customer/reservations/reservation%20with%20space");
    expect(
      buildWebPath("customer-reservation-payment", {
        reservationId: "reservation-05",
      }),
    ).toBe("/customer/reservations/reservation-05/payment");
    expect(
      buildWebPath("customer-reservation-order-new", {
        reservationId: "reservation-06",
      }),
    ).toBe("/customer/reservations/reservation-06/orders/new");
    expect(
      buildWebPath("customer-reservation-order-confirm", {
        reservationId: "reservation-06",
      }),
    ).toBe("/customer/reservations/reservation-06/orders/new/confirm");
    expect(
      buildWebPath("customer-order-payment", { orderId: "order-06" }),
    ).toBe("/customer/orders/order-06/payment");
    expect(
      buildWebPath("customer-reservation-repair-new", {
        reservationId: "reservation-06",
      }),
    ).toBe("/customer/reservations/reservation-06/repairs/new");
    expect(
      buildWebPath("customer-repair-detail", { repairId: "repair-06" }),
    ).toBe("/customer/repairs/repair-06");
  });

  it("parses every generated canonical route back to the same route identity", () => {
    for (const route of WEB_ROUTE_MANIFEST.filter(
      (candidate) => candidate.kind !== "parent",
    )) {
      const params = Object.fromEntries(
        [...route.template.matchAll(/:([A-Za-z][A-Za-z0-9]*)/gu)].map(
          (match) => [match[1], `${match[1]}-sample`],
        ),
      );
      const generated = buildWebPath(route.id, params);
      const parsed = parseWebRoute(generated);
      expect(parsed, route.id).toMatchObject({
        canonicalUrl: generated,
        matchedRouteId: route.id,
        needsReplace: false,
        routeId: route.id,
        status: "matched",
      });
    }
  });

  it("replaces role and default-tab parents with one canonical destination", () => {
    expect(parseWebRoute("/staff")).toMatchObject({
      canonicalUrl: "/staff/workbench",
      matchedRouteId: "staff-root",
      needsReplace: true,
      routeId: "staff-workbench",
    });
    expect(parseWebRoute("/staff/orders?q=林澈")).toMatchObject({
      canonicalUrl: "/staff/orders/all?q=%E6%9E%97%E6%BE%88",
      routeId: "staff-orders-all",
    });
    expect(parseWebRoute("/manager/configuration")).toMatchObject({
      canonicalUrl: "/manager/configuration/profile",
      routeId: "manager-configuration-profile",
    });
    expect(parseWebRoute("/hq/stores")).toMatchObject({
      canonicalUrl: "/hq/stores/prism-flagship/profile",
      routeId: "hq-store-profile",
    });
    expect(parseWebRoute("/hq/stores/apex-new")).toMatchObject({
      canonicalUrl: "/hq/stores/apex-new/profile",
      params: { storeCode: "apex-new" },
      routeId: "hq-store-profile",
    });
  });

  it("canonicalizes lowercase static segments, trailing slashes, and query order", () => {
    const parsed = parseWebRoute(
      "/STAFF/RESERVATIONS/?machine=competitive&unknown=drop&area=arena&q=%E6%9E%97%E6%BE%88&status=confirmed",
    );
    expect(parsed).toMatchObject({
      canonicalUrl:
        "/staff/reservations?q=%E6%9E%97%E6%BE%88&status=confirmed&area=arena&machine=competitive",
      needsReplace: true,
      routeId: "staff-reservations",
      status: "matched",
    });
    if (parsed.status !== "matched") throw new Error("Expected a route match");
    expect([...parsed.query.keys()]).toEqual([
      "q",
      "status",
      "area",
      "machine",
    ]);
  });

  it("restores only approved customer journey filters and omits defaults", () => {
    expect(
      parseWebRoute(
        "/customer/journeys/history?refunds=only&type=repair&unknown=drop",
      ),
    ).toMatchObject({
      canonicalUrl: "/customer/journeys/history?type=repair&refunds=only",
      needsReplace: true,
      routeId: "customer-journeys-history",
    });
    expect(
      parseWebRoute("/customer/journeys/current?type=reservation&refunds=all"),
    ).toMatchObject({
      canonicalUrl: "/customer/journeys/current",
      needsReplace: true,
    });
    expect(
      buildWebPath("customer-journeys-current", {}, { type: "order" }),
    ).toBe("/customer/journeys/current?type=order");
  });

  it("emits each allowed query once in the contract-wide fixed order", () => {
    const input = new URLSearchParams();
    for (const name of [...WEB_QUERY_ORDER].reverse()) input.append(name, name);
    input.append("q", "last-query");

    expect(buildWebPath("manager-audit", {}, input)).toBe(
      "/manager/audit?q=last-query&sort=sort&direction=direction&range=range&from=from&to=to&persona=persona&role=role&action=action&object=object&result=result",
    );
  });

  it("keeps dynamic object identity while rejecting unknown pages", () => {
    expect(parseWebRoute("/staff/orders/ORDER-ABC")).toMatchObject({
      canonicalUrl: "/staff/orders/ORDER-ABC",
      params: { orderId: "ORDER-ABC" },
      routeId: "staff-order-detail",
    });
    expect(parseWebRoute("/staff/not-a-page")).toEqual({
      status: "not-found",
    });
  });

  it("marks only the public root as indexable", () => {
    expect(webRouteMetadata("public-root").indexable).toBe(true);
    expect(webRouteMetadata("staff-workbench")).toMatchObject({
      heading: "现场脉冲",
      indexable: false,
      kind: "page",
      role: "staff",
    });
    expect(webRouteMetadata("staff-order-detail").kind).toBe("detail");
  });

  it("keeps manifest identities unique and static segments lowercase kebab-case", () => {
    expect(new Set(WEB_ROUTE_MANIFEST.map((route) => route.id)).size).toBe(
      WEB_ROUTE_MANIFEST.length,
    );
    for (const route of WEB_ROUTE_MANIFEST) {
      for (const segment of route.template.split("/").filter(Boolean)) {
        if (segment.startsWith(":")) continue;
        expect(segment, route.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      }
      if (route.id !== "public-root") {
        expect(route.template, route.id).not.toMatch(/\/$/u);
      }
    }
  });
});
