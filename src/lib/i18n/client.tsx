"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Messages } from "./translator";

type I18nContextValue = { locale: string; messages: Messages };

const I18nContext = createContext<I18nContextValue | null>(null);

/** Provides a (partial) dictionary to client components on public pages. */
export function I18nProvider({ locale, messages, children }: I18nContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  const translator = useMemo(() => createTranslator(ctx.messages), [ctx.messages]);
  return { locale: ctx.locale, ...translator };
}
