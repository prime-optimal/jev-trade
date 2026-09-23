import { ApiRequestError, type ExchangeClient, type InfoClient } from "@nktkas/hyperliquid";
import { safeTransportMessage } from "./hyperliquid";

const CLOID_PREFIX = "0x4a455654";

export type OwnedOrder = {
  cloid: `0x${string}`;
  oid: number | null;
  state: "submitting" | "acknowledged" | "unknown";
};

export function createOwnedCloid(assetId: number): `0x${string}` {
  const asset = Math.max(0, Math.min(0xffff, assetId)).toString(16).padStart(4, "0");
  const random = crypto.getRandomValues(new Uint8Array(10));
  const suffix = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${CLOID_PREFIX.slice(0, 10)}${asset}${suffix}` as `0x${string}`;
}

export function isOwnedCloid(value: unknown): value is `0x${string}` {
  return typeof value === "string" && value.toLowerCase().startsWith(CLOID_PREFIX);
}

export function isCleanupExchangeRequest(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("action" in payload)) return false;
  const action = payload.action;
  if (!action || typeof action !== "object" || !("type" in action)) return false;
  return action.type === "cancel" || action.type === "cancelByCloid";
}

export async function discoverOwnedOrders(
  info: InfoClient,
  wallet: `0x${string}`,
  coin: string,
  owned: Map<`0x${string}`, OwnedOrder>,
): Promise<number> {
  const opens = await info.openOrders({ user: wallet });
  let unidentified = 0;
  for (const order of opens) {
    if (order.coin !== coin) continue;
    if (isOwnedCloid(order.cloid)) {
      const cloid = order.cloid.toLowerCase() as `0x${string}`;
      owned.set(cloid, { cloid, oid: order.oid, state: "acknowledged" });
    } else {
      unidentified++;
    }
  }
  return unidentified;
}

export async function reconcileOwnedOrderStatuses(
  info: InfoClient,
  wallet: `0x${string}`,
  owned: Map<`0x${string}`, OwnedOrder>,
): Promise<void> {
  for (const entry of [...owned.values()]) await resolveStatus(info, wallet, entry, owned);
}

export async function cleanupOwnedOrders(args: {
  info: InfoClient;
  exchange: ExchangeClient;
  wallet: `0x${string}`;
  assetId: number;
  label: string;
  owned: Map<`0x${string}`, OwnedOrder>;
  placementsInFlight: number;
}): Promise<void> {
  const { info, exchange, wallet, assetId, label, owned, placementsInFlight } = args;
  if (placementsInFlight) throw new Error(`${label}: ${placementsInFlight} exchange placement request(s) still in flight`);

  for (const entry of [...owned.values()]) await resolveStatus(info, wallet, entry, owned);
  if (!owned.size) return;

  try {
    await exchange.cancelByCloid({
      cancels: [...owned.values()].map(({ cloid }) => ({ asset: assetId, cloid })),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      for (const entry of [...owned.values()]) await resolveStatus(info, wallet, entry, owned, true);
      if (!owned.size) return;
    }
    throw new Error(`${label}: failed to cancel owned orders: ${safeTransportMessage(error)}`);
  }

  for (const entry of [...owned.values()]) await resolveStatus(info, wallet, entry, owned, true);
  if (owned.size) throw new Error(`${label}: ${owned.size} owned order(s) remain open or ambiguous`);
}

async function resolveStatus(
  info: InfoClient,
  wallet: `0x${string}`,
  entry: OwnedOrder,
  owned: Map<`0x${string}`, OwnedOrder>,
  canceled = false,
): Promise<void> {
  let result;
  try {
    result = await info.orderStatus({ user: wallet, oid: entry.cloid });
  } catch (error) {
    throw new Error(`could not reconcile owned order ${entry.cloid}: ${safeTransportMessage(error)}`);
  }
  if (result.status === "unknownOid") {
    if (canceled) owned.delete(entry.cloid);
    else entry.state = "unknown";
    return;
  }
  const status = result.order.status;
  if (status === "open" || status === "triggered") {
    entry.oid = result.order.order.oid;
    entry.state = "acknowledged";
    return;
  }
  owned.delete(entry.cloid);
}

