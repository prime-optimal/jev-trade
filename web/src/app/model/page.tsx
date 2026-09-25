import type { Metadata } from "next";
import ModelView from "./ModelView";

export const metadata: Metadata = {
  title: "Model | Jev Trade",
  robots: { index: false, follow: false },
};

export default function ModelPage() {
  return <ModelView />;
}
