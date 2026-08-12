import type { Metadata } from "next";

import { webRouteMetadata } from "../../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-journeys-future").title,
};

export default function CustomerFutureJourneysPage() {
  return <span data-role-route="customer-journeys-future" />;
}
