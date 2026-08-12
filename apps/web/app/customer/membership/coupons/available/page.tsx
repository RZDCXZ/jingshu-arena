import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-coupons-available").title,
};

export default function CustomerAvailableCouponsPage() {
  return <span data-role-route="customer-coupons-available" />;
}
