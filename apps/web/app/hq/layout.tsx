import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RoleRouteLayout } from "../role-route-layout";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default function HeadquartersLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <RoleRouteLayout role="hq">{children}</RoleRouteLayout>;
}
