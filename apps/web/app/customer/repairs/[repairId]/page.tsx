import type { Metadata } from "next";

import { webRouteMetadata } from "../../../web-route-contract";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ repairId: string }>;
}): Promise<Metadata> {
  await params;
  return { title: webRouteMetadata("customer-repair-detail").title };
}

export default function CustomerRepairDetailPage() {
  return <span data-role-route="customer-repair-detail" />;
}
