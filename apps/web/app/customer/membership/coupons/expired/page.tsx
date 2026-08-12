import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-coupons-expired").title,
};

export default function CustomerExpiredCouponsPage() {
  return <span data-role-route="customer-coupons-expired" />;
}
