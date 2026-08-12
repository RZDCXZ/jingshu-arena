import type { CustomerExperienceCouponStatus } from "@jingshu/contracts";

export type CustomerJourneyTab = "current" | "future" | "history";
export type CustomerJourneyType = "order" | "repair" | null;
export type CustomerRefundFilter = "all" | "only";

export type CustomerRouteState =
  | { readonly kind: "reservations" }
  | { readonly kind: "reservation-seats" }
  | { readonly kind: "reservation-confirm" }
  | {
      readonly kind: "reservation-detail";
      readonly reservationId: string;
    }
  | {
      readonly kind: "reservation-payment";
      readonly reservationId: string;
    }
  | { readonly kind: "stores" }
  | {
      readonly kind: "journeys";
      readonly refunds: CustomerRefundFilter;
      readonly tab: CustomerJourneyTab;
      readonly type: CustomerJourneyType;
    }
  | {
      readonly couponStatus: CustomerExperienceCouponStatus;
      readonly kind: "membership";
    };

export function customerJourneyPath(
  tab: CustomerJourneyTab,
  options: {
    readonly refunds?: CustomerRefundFilter;
    readonly type?: CustomerJourneyType;
  } = {},
) {
  const query = new URLSearchParams();
  if (options.type) query.set("type", options.type);
  if (tab === "history" && options.refunds === "only") {
    query.set("refunds", "only");
  }
  const search = query.toString();
  return `/customer/journeys/${tab}${search ? `?${search}` : ""}`;
}

export function customerReservationPath(reservationId: string) {
  return `/customer/reservations/${encodeURIComponent(reservationId)}`;
}

export function customerReservationPaymentPath(reservationId: string) {
  return `${customerReservationPath(reservationId)}/payment`;
}

export function customerPagePath(page: string) {
  if (page === "customer-orders") {
    return customerJourneyPath("current", { type: "order" });
  }
  if (page === "customer-repairs") {
    return customerJourneyPath("current", { type: "repair" });
  }
  if (page === "customer-reservations") {
    return customerJourneyPath("current");
  }
  return "/customer/reservations";
}
