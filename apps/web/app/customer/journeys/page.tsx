import { redirect } from "next/navigation";

import { buildWebPath } from "../../web-route-contract";

export default async function CustomerJourneysRootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const query = new URLSearchParams();
  for (const name of ["type", "refunds"] as const) {
    const value = input[name];
    const last = Array.isArray(value) ? value.at(-1) : value;
    if (last) query.set(name, last);
  }
  redirect(buildWebPath("customer-journeys-current", {}, query));
}
