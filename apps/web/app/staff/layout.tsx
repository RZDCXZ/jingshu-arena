import type { Metadata } from "next";
import type { ReactNode } from "react";

import { StaffRouteLayout } from "./staff-route-layout";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffRouteLayout>{children}</StaffRouteLayout>;
}
