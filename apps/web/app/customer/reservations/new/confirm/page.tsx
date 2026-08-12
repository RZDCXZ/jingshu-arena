import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-reservation-confirm").title,
};

export default function CustomerReservationConfirmPage() {
  return <span data-role-route="customer-reservation-confirm" />;
}
