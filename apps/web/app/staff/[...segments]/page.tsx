import type { Metadata } from "next";

import { parseWebRoute, webRouteMetadata } from "../../web-route-contract";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}): Promise<Metadata> {
  const { segments } = await params;
  const route = parseWebRoute(`/staff/${segments.join("/")}`);
  return route.status === "matched"
    ? { title: webRouteMetadata(route.routeId).title }
    : { title: "页面不存在｜竞枢" };
}

export default function StaffRoutePage() {
  return <span data-role-route="staff" />;
}
