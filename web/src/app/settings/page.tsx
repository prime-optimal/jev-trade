import type { Metadata } from "next";
import SettingsForm from "./SettingsForm";

export const metadata: Metadata = {
  title: "Settings | Jev Trade",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <SettingsForm />;
}
