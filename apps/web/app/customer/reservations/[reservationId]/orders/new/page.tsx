import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../../web-route-contract";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}): Promise<Metadata> {
  await params;
  return { title: webRouteMetadata("customer-reservation-order-new").title };
}

export default function CustomerOrderCatalogPage() {
  return <span data-role-route="customer-reservation-order-new" />;
}
