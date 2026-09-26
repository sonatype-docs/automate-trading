import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsPage } from "./analytics";

export const Route = createFileRoute("/")({
  component: AnalyticsPage,
  head: () => ({
    meta: [
      { title: "Dashboard — Shark Auto Trader" },
      { name: "description", content: "Production trading dashboard and quant analytics." },
    ],
  }),
});
