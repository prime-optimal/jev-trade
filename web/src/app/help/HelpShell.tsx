"use client";

import type { ReactNode } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";

export default function HelpShell({ children }: { children: ReactNode }) {
  const { feed } = useSettings();
  return <div className="shell">
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    {children}
  </div>;
}
