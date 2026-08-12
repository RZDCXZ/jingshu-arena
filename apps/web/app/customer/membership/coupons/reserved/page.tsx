import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-coupons-reserved").title,
};

export default function CustomerReservedCouponsPage() {
  return <span data-role-route="customer-coupons-reserved" />;
}
