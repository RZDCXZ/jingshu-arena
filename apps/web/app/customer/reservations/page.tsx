import type { Metadata } from "next";

import { webRouteMetadata } from "../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-reservations").title,
};

export default function CustomerReservationsPage() {
  return <span data-role-route="customer-reservations" />;
}
