import { useEffect, useRef, useState } from "react";
import { createPrototypeRouter } from "./router.js";

export function usePrototypeRouter() {
  const routerRef = useRef(null);
  if (!routerRef.current) {
    routerRef.current = createPrototypeRouter(window);
  }

  const router = routerRef.current;
  const [route, setRoute] = useState(router.read);

  useEffect(() => router.start(setRoute), [router]);

  useEffect(() => {
    if (route.matched) document.title = route.title;
  }, [route.matched, route.title]);

  return { route, router };
}
