import type { Metadata } from "next";

import { webRouteMetadata } from "../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-journeys-current").title,
};

export default function CustomerCurrentJourneysPage() {
  return <span data-role-route="customer-journeys-current" />;
}
