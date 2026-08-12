import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<Metadata> {
  await params;
  return { title: webRouteMetadata("customer-order-payment").title };
}

export default function CustomerOrderPaymentPage() {
  return <span data-role-route="customer-order-payment" />;
}
