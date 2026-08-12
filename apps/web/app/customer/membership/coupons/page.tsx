import { redirect } from "next/navigation";

export default function CustomerCouponsRootPage() {
  redirect("/customer/membership/coupons/available");
}
