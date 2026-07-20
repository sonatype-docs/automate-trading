import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/backtest/pdh-pdl-sweep")({
  beforeLoad: () => {
    throw redirect({ to: "/backtest/liquidity-lab", search: { preset: "pdh-pdl" } });
  },
});
