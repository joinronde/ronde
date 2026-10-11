"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/shared/base-path";

/** The browser's offer to install the app, kept for the "Install the app" button of the account page */
export interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
declare global {
  interface Window {
    rondeInstall?: InstallPrompt | null;
  }
}
export const INSTALLABLE_EVENT = "ronde-installable";

/** Registers the service worker (public/sw.js): what makes Ronde installable and lets it get push notifications */
export function ServiceWorker() {
  useEffect(() => {
    // The offer comes once, early: kept until the person asks for it
    const keep = (e: Event) => {
      e.preventDefault();
      window.rondeInstall = e as InstallPrompt;
      window.dispatchEvent(new Event(INSTALLABLE_EVENT));
    };
    window.addEventListener("beforeinstallprompt", keep);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register(withBasePath("/sw.js"), { scope: withBasePath("/") }).catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  return null;
}
