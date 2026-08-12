import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-reservation-seats").title,
};

export default function CustomerReservationSeatsPage() {
  return <span data-role-route="customer-reservation-seats" />;
}
