"use client";

import { useEffect, useState } from "react";

/**
 * True once the page's code runs. Until then a form's button stays disabled: on a slow phone the page shows before
 * React takes it over, and a click would send the form natively (its fields unnamed) and empty it
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
