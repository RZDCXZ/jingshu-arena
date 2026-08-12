import type { Metadata } from "next";

import { webRouteMetadata } from "../../web-route-contract";

export const metadata: Metadata = {
  title: webRouteMetadata("customer-stores").title,
};

export default function CustomerStoresPage() {
  return <span data-role-route="customer-stores" />;
}
