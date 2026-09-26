import { createSharkClient, type ExchangeClient } from "@/lib/exchange/shark-client.server";

export type BrokerId = "shark";
export type BrokerAdapter = ExchangeClient;

export function createBrokerAdapter(
  requested: string | undefined = process.env.LIVE_BROKER ?? "shark",
): BrokerAdapter {
  const broker = requested.trim().toLowerCase();
  if (broker === "shark") return createSharkClient();
  throw new Error("Unsupported live broker adapter: " + broker);
}
