"use client";

import { useEffect } from "react";
import type { Locale } from "@/lib/i18n";

export function PwaRegistration({ locale }: { locale: Locale }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let current = true;
    const serviceWorker = navigator.serviceWorker;
    const message = { type: "glowflow-locale", locale };
    const sendToController = () => {
      if (current) serviceWorker.controller?.postMessage(message);
    };
    serviceWorker.addEventListener("controllerchange", sendToController);
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async () => {
      const registration = await serviceWorker.ready;
      if (current) (serviceWorker.controller ?? registration.active)?.postMessage(message);
    }).catch(() => {
      // The online site remains usable if a browser declines registration.
    });
    return () => {
      current = false;
      serviceWorker.removeEventListener("controllerchange", sendToController);
    };
  }, [locale]);

  return null;
}
