import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-coupons-redeemed").title,
};

export default function CustomerRedeemedCouponsPage() {
  return <span data-role-route="customer-coupons-redeemed" />;
}
