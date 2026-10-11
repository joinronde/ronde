"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const onApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** A keyboard shortcut with the platform's modifier: ⌘K on Apple devices, Ctrl K elsewhere */
export function ModKey({ k }: { k: string }) {
  const apple = useSyncExternalStore(subscribe, onApple, () => true);
  return <kbd aria-hidden="true">{apple ? `⌘${k}` : `Ctrl ${k}`}</kbd>;
}
