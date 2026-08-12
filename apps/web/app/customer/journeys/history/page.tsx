import type { Metadata } from "next";

import { webRouteMetadata } from "../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-journeys-history").title,
};

export default function CustomerHistoryJourneysPage() {
  return <span data-role-route="customer-journeys-history" />;
}
