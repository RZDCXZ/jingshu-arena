import type { Metadata } from "next";

import { webRouteMetadata } from "../../../../web-route-contract";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}): Promise<Metadata> {
  await params;
  return { title: webRouteMetadata("customer-reservation-payment").title };
}

export default function CustomerReservationPaymentPage() {
  return <span data-role-route="customer-reservation-payment" />;
}
