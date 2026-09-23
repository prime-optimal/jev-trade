import { ApiRequestError, ExchangeClient, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { config, hexKey } from "./config";
import { createHttpTransport, hyperliquidMetadata, safeTransportMessage } from "./hyperliquid";
import { accountFromClearinghouse, fillDir, FillPnlBook, type ClearinghouseLike, type FillPnlLike, type VenueAccount } from "./account";
import { quotePrice, takerPrice } from "./book";
import type { Feed } from "./feed";
import { cleanupOwnedOrders, createOwnedCloid, discoverOwnedOrders, isCleanupExchangeRequest, reconcileOwnedOrderStatuses, type OwnedOrder } from "./owned-orders";
import { type SleeveConfig } from "./sleeves";
import type { RunGuard } from "./run-lifecycle";
import type { Book, Fill, Quote } from "./legacy-types";
import type { Side } from "./types";

type Ex = ExchangeClient;

type QuoteBase = Required<Pick<Quote, "side" | "reduceOnly" | "capped" | "taker">>;

/** Hyperliquid perp: Alo post-only quotes, modify when the side stays put. */
export class Market {
  readonly wallet: PrivateKeyAccount | null;
  readonly coin: string;
  readonly pair: string;
  readonly label: string;
  private cleanupEx: Ex | null = null;
  readonly margin = { usdc: 0 };
  account: VenueAccount | null = null;
  szDecimals = 5;
  maxLeverage = 50;
  private info: InfoClient;
  private ex: Ex | null = null;
  private assetId = 0;
  private lastOid: number | null = null;
  private lastCloid: `0x${string}` | null = null;
  private lastSide: Side | null = null;
  private lastPrice = 0;
  private lastSize = 0;
  private lastReduce = false;
  private runGuard: RunGuard | null;
  private owned = new Map<`0x${string}`, OwnedOrder>();
  private fills = new FillPnlBook();
  private placementsInFlight = 0;
  readonly fillPrints: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"]; hash?: string }[] = [];
  onVenueFill: ((fill: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"]; hash?: string }) => void) | null = null;
  get chartPoints() {
    return this.feed.chart.points;
  }
  get assetCtx() {
    return this.feed.assetCtx;
  }
  candleCloses(limit = 80) {
    return this.feed.chart.closes(limit);
  }
  constructor(private feed: Feed, sleeve: SleeveConfig, runGuard: RunGuard | null = null) {
    this.coin = sleeve.coin;
    this.pair = sleeve.pair;
    this.label = sleeve.label;
    this.runGuard = runGuard;
    this.wallet = config.dryRun || !sleeve.privateKey ? null : privateKeyToAccount(hexKey(sleeve.privateKey));
    const transport = createHttpTransport(undefined, (payload: unknown) => {
      if (isCleanupExchangeRequest(payload)) return;
      this.assertRunLive();
    });
    this.info = new InfoClient({ transport });
    if (this.wallet) {
      this.ex = new ExchangeClient({ transport, wallet: this.wallet });
      this.cleanupEx = new ExchangeClient({ transport: createHttpTransport(), wallet: this.wallet });
    }
  }
  setRunGuard(guard: RunGuard | null) {
    this.runGuard = guard;
  }
  get address() {
    return this.wallet?.address ?? null;
  }

  quoteSize(mid: number): number {
    return lot(config.quoteUsd / Math.max(mid, 1e-9), this.szDecimals);
  }

  async init() {
    const converter = await hyperliquidMetadata.symbolConverter();
    const assetId = converter.getAssetId(this.coin);
    const szDecimals = converter.getSzDecimals(this.coin);
    if (assetId == null || szDecimals == null) throw new Error(`unknown Hyperliquid coin ${this.coin}`);
    this.assetId = assetId;
    this.szDecimals = szDecimals;
    if (this.wallet && this.ex) {
      this.feed.onClearinghouse = (state) => this.applyClearinghouse(state);
      this.feed.onUserPnl = (fill) => this.noteFill(fill);
      this.feed.watchUser(this.wallet.address);
      this.feed.onGone = (oid) => {
        if (this.lastOid === oid) this.forgetResting();
        for (const owned of this.owned.values()) {
          if (owned.oid === oid) this.owned.delete(owned.cloid);
        }
      };
    }
    await this.loadMaxLeverage();
    await this.refresh();
    if (this.address) await this.seedFills();
    const net = config.hlTestnet ? "testnet" : "mainnet";
    console.log(`hyperliquid ${this.pair} ${net}, ${this.coin} asset ${this.assetId}, szDecimals ${this.szDecimals}, max ${this.maxLeverage}x, ${this.wallet ? `wallet ${this.address}` : "DRY RUN"}`);
    if (this.wallet) {
      const a = this.account;
      const side = !a || !a.positionSz ? "flat" : a.positionSz > 0 ? "long" : "short";
      const size = a ? Math.abs(a.positionSz) : 0;
      const entry = a?.entryPrice != null ? ` @ ${a.entryPrice}` : "";
      console.log(`${this.label}: withdrawable $${this.margin.usdc.toFixed(2)}, account $${(a?.accountValue ?? 0).toFixed(2)}, ${side} ${size} ${this.coin}${entry}`);
    }
  }

  applyClearinghouse(state: ClearinghouseLike) {
    this.account = this.fills.apply(accountFromClearinghouse(state, this.coin, this.account));
    this.margin.usdc = this.account.withdrawable;
  }

  noteFill(fill: FillPnlLike) {
    if (!this.fills.add(fill, this.coin)) return;
    if (this.account) this.account = this.fills.apply(this.account);
    const ts = Number(fill.time);
    const price = Number(fill.px);
    const size = Number(fill.sz);
    const side: Side | null =
      fill.side === "B" || fill.side === "buy" ? "buy" : fill.side === "A" || fill.side === "sell" ? "sell" : null;
    if (side && Number.isFinite(ts) && ts > 0 && Number.isFinite(price) && price > 0) {
      const hash = typeof fill.hash === "string" && fill.hash ? fill.hash : undefined;
      const closedPnl = Number(fill.closedPnl);
      const feeUsd = Number(fill.fee);
      const print = {
        ts,
        side,
        price,
        size: Number.isFinite(size) ? size : 0,
        dir: fillDir(fill.dir),
        hash,
        ...(Number.isFinite(closedPnl) ? { closedPnl } : {}),
        ...(Number.isFinite(feeUsd) ? { feeUsd } : {}),
      };
      this.fillPrints.push(print);
      if (this.feed.chart.addFill(print)) this.onVenueFill?.(print);
    }
  }

  private async seedFills() {
    if (!this.address) return;
    try {
      const fills = await this.info.userFills({ user: this.address });
      for (const f of fills) this.noteFill(f);
    } catch {
      // keep whatever WS has already delivered
    }
  }

  async refresh() {
    if (!this.address) return;
    try {
      this.applyClearinghouse(await this.info.clearinghouseState({ user: this.address }) as unknown as ClearinghouseLike);
    } catch {
      // keep last balances
    }
  }

  readBook(): Book {
    if (!this.feed.book) throw new Error(`no Hyperliquid book yet for ${this.coin}`);
    return this.feed.book;
  }

  async setLeverage(raw: number): Promise<number> {
    this.assertRunLive();
    const leverage = Math.max(1, Math.min(this.maxLeverage, Math.round(raw)));
    if (!this.ex) return leverage;
    if (this.account?.leverage === leverage) return leverage;
    this.assertRunLive();
    try {
      await this.ex.updateLeverage({ asset: this.assetId, isCross: true, leverage });
      if (this.account) this.account.leverage = leverage;
      return leverage;
    } catch (e) {
      if (!this.runGuard?.isLive()) throw e;
      console.warn(`${this.label} leverage: ${safeTransportMessage(e).slice(0, 160)}`);
      return this.account?.leverage ?? leverage;
    }
  }

  /** Entries rest post-only. Exits cross as Ioc so they do not wait on a taker. */
  async send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly = false, taker = false): Promise<Quote> {
    this.assertRunLive();
    const size = lot(sizeSz, this.szDecimals);
    const base: QuoteBase = { side, reduceOnly, capped: false, taker };
    if (size <= 0) {
      return { ...base, price: 0, size: 0, txHash: null, cancel, status: "reverted", orderId: null };
    }
    const px = taker
      ? Number(formatPrice(takerPrice(side, book, this.szDecimals), this.szDecimals))
      : this.restingPx(side, book);
    if (!this.ex) {
      return { ...base, price: px, size, txHash: null, cancel, status: "sim", orderId: null };
    }
    return taker ? this.sendTaker(size, px, base) : this.sendMaker(size, px, cancel, base);
  }

  /** Post-only price, clamped so it can never cross and get rejected. */
  private restingPx(side: Side, book: Book): number {
    let px = Number(formatPrice(quotePrice(side, book, this.szDecimals), this.szDecimals));
    if (side === "sell" && px <= book.bid) px = Number(formatPrice(book.ask, this.szDecimals));
    if (side === "buy" && px >= book.ask) px = Number(formatPrice(book.bid, this.szDecimals));
    return px;
  }

  private limitOrder(
    side: Side,
    size: number,
    px: number,
    reduceOnly: boolean,
    tif: "Alo" | "Ioc",
    cloid: `0x${string}`,
  ) {
    return {
      a: this.assetId,
      b: side === "buy",
      p: formatPrice(px, this.szDecimals),
      s: formatSize(size, this.szDecimals),
      r: reduceOnly,
      t: { limit: { tif } },
      c: cloid,
    };
  }

  private async sendTaker(size: number, px: number, base: QuoteBase): Promise<Quote> {
    if (!(await this.resolvePendingPlacement())) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "reverted", orderId: null };
    }
    // The standing entry sits on the far side of an exit. Pull it before crossing.
    const open = this.lastOid;
    const cancel = open != null ? [open] : [];
    if (open != null) {
      this.assertRunLive();
      await this.ex!.cancel({ cancels: [{ a: this.assetId, o: open }] });
      this.dropOwnedOid(open);
      this.forgetResting();
    }
    const cloid = this.beginPlacement();
    try {
      this.assertRunLive();
      const res = await this.ex!.order({
        orders: [this.limitOrder(base.side, size, px, base.reduceOnly, "Ioc", cloid)],
        grouping: "na",
      });
      const st = res.response.data.statuses[0];
      if (st && typeof st === "object" && "filled" in st) {
        this.acknowledge(cloid, st.filled.oid);
        this.owned.delete(cloid);
        return {
          ...base,
          price: Number(st.filled.avgPx) || px,
          size: Number(st.filled.totalSz) || size,
          txHash: null,
          cancel,
          status: "placed",
          orderId: st.filled.oid,
        };
      }
      if (st && typeof st === "object" && "error" in st) this.owned.delete(cloid);
      else this.markUnknown(cloid);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: null };
    } catch (e) {
      this.recordPlacementFailure(cloid, e);
      if (!this.runGuard?.isLive()) throw e;
      this.warn("exit", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: null };
    } finally {
      this.placementsInFlight--;
    }
  }

  private async sendMaker(size: number, px: number, cancel: number[], base: QuoteBase): Promise<Quote> {
    if (!(await this.resolvePendingPlacement())) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "reverted", orderId: null };
    }
    const { side, reduceOnly } = base;
    if (
      this.lastOid != null &&
      this.lastSide === side &&
      this.lastPrice === px &&
      this.lastSize === size &&
      this.lastReduce === reduceOnly
    ) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid, unchanged: true };
    }

    const cloid = createOwnedCloid(this.assetId);
    const order = this.limitOrder(side, size, px, reduceOnly, "Alo", cloid);
    try {
      this.assertRunLive();
      if (this.lastOid != null && this.lastSide === side && this.lastReduce === reduceOnly) {
        this.trackPlacement(cloid);
        try {
          this.assertRunLive();
          await this.ex!.modify({ oid: this.lastOid, order });
          this.acknowledge(cloid, this.lastOid);
          if (this.lastCloid) this.owned.delete(this.lastCloid);
          this.lastCloid = cloid;
          this.lastPrice = px;
          this.lastSize = size;
          return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid };
        } catch (e) {
          this.recordPlacementFailure(cloid, e);
          throw e;
        } finally {
          this.placementsInFlight--;
        }
      }

      const oids = this.lastOid != null ? [this.lastOid] : cancel.filter((id) => id > 0);
      if (oids.length) {
        this.assertRunLive();
        await this.ex!.cancel({ cancels: oids.map((o) => ({ a: this.assetId, o })) });
        for (const oid of oids) this.dropOwnedOid(oid);
        this.forgetResting();
      }

      this.trackPlacement(cloid);
      try {
        this.assertRunLive();
        const res = await this.ex!.order({ orders: [order], grouping: "na" });
        const st = res.response.data.statuses[0];
        if (st && typeof st === "object" && "resting" in st) {
          this.acknowledge(cloid, st.resting.oid);
          this.lastOid = st.resting.oid;
          this.lastCloid = cloid;
          this.lastSide = side;
          this.lastPrice = px;
          this.lastSize = size;
          this.lastReduce = reduceOnly;
          return { ...base, price: px, size, txHash: null, cancel: oids, status: "placed", orderId: this.lastOid };
        }
        if (st && typeof st === "object" && "filled" in st) {
          this.acknowledge(cloid, st.filled.oid);
          this.owned.delete(cloid);
          this.forgetResting();
          return { ...base, price: px, size, txHash: null, cancel: oids, status: "placed", orderId: st.filled.oid };
        }
        if (st && typeof st === "object" && "error" in st) this.owned.delete(cloid);
        else this.markUnknown(cloid);
        this.forgetResting();
        return { ...base, price: px, size, txHash: null, cancel: oids, status: "reverted", orderId: null };
      } catch (e) {
        this.recordPlacementFailure(cloid, e);
        throw e;
      } finally {
        this.placementsInFlight--;
      }
    } catch (e) {
      if (!this.runGuard?.isLive()) throw e;
      this.warn("quote", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: this.lastOid };
    }
  }

  /** Pull the standing quote. A resting order Jev no longer wants still gets hit. */
  async cancelResting(): Promise<number[]> {
    const oid = this.lastOid;
    if (!this.ex || oid == null) return [];
    this.assertRunLive();
    await this.ex.cancel({ cancels: [{ a: this.assetId, o: oid }] });
    this.dropOwnedOid(oid);
    this.forgetResting();
    return [oid];
  }

  /** Recover and clean bot-namespaced orders left by a prior process. */
  async reconcileStartupOwned(): Promise<void> {
    if (!this.cleanupEx || !this.wallet) return;
    let unidentified: number;
    try {
      unidentified = await discoverOwnedOrders(this.info, this.wallet.address, this.coin, this.owned);
    } catch (error) {
      throw new Error(`${this.label}: could not discover prior owned orders: ${safeTransportMessage(error)}`);
    }
    if (unidentified) {
      console.warn(`${this.label}: ${unidentified} existing order(s) have no Jev ownership marker and were left untouched; review them manually`);
    }
    await this.cleanupOwned();
  }

  async cleanupOwned(): Promise<void> {
    if (!this.cleanupEx || !this.wallet) {
      this.owned.clear();
      this.forgetResting();
      return;
    }
    await cleanupOwnedOrders({
      info: this.info,
      exchange: this.cleanupEx,
      wallet: this.wallet.address,
      assetId: this.assetId,
      label: this.label,
      owned: this.owned,
      placementsInFlight: this.placementsInFlight,
    });
    this.forgetResting();
  }

  private beginPlacement(): `0x${string}` {
    const cloid = createOwnedCloid(this.assetId);
    this.trackPlacement(cloid);
    return cloid;
  }

  private trackPlacement(cloid: `0x${string}`) {
    this.owned.set(cloid, { cloid, oid: null, state: "submitting" });
    this.placementsInFlight++;
  }

  private acknowledge(cloid: `0x${string}`, oid: number) {
    this.owned.set(cloid, { cloid, oid, state: "acknowledged" });
  }

  private markUnknown(cloid: `0x${string}`) {
    const owned = this.owned.get(cloid);
    if (owned) owned.state = "unknown";
  }

  private async resolvePendingPlacement(): Promise<boolean> {
    if (!this.wallet) return true;
    const pending = [...this.owned.values()].filter(({ state }) => state !== "acknowledged");
    if (!pending.length) return true;
    await reconcileOwnedOrderStatuses(this.info, this.wallet.address, this.owned);
    if ([...this.owned.values()].some(({ state }) => state !== "acknowledged")) return false;
    const active = [...this.owned.values()].find(({ oid }) => oid != null);
    if (active?.oid != null) {
      this.lastOid = active.oid;
      this.lastCloid = active.cloid;
      this.lastSide = null;
    }
    return true;
  }

  private recordPlacementFailure(cloid: `0x${string}`, error: unknown) {
    if (error instanceof ApiRequestError) this.owned.delete(cloid);
    else this.markUnknown(cloid);
  }

  private dropOwnedOid(oid: number) {
    for (const owned of this.owned.values()) {
      if (owned.oid === oid) this.owned.delete(owned.cloid);
    }
  }

  private assertRunLive() {
    this.runGuard?.assertLive();
  }

  private forgetResting() {
    this.lastOid = null;
    this.lastCloid = null;
    this.lastSide = null;
    this.lastPrice = 0;
    this.lastSize = 0;
    this.lastReduce = false;
  }

  private warn(what: string, e: unknown) {
    const msg = safeTransportMessage(e);
    if (/rate.?limit/i.test(msg)) console.warn(`${this.label}: hyperliquid rate limited; ${what} skipped`);
    else console.warn(`${this.label} ${what}: ${msg.slice(0, 180)}`);
  }

  private async loadMaxLeverage() {
    try {
      const maxLeverage = await hyperliquidMetadata.maxLeverage(this.coin);
      if (maxLeverage != null) this.maxLeverage = maxLeverage;
    } catch {
      // keep 50
    }
  }
}

function lot(raw: number, szDecimals: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const factor = 10 ** szDecimals;
  const floored = Math.floor(raw * factor) / factor;
  if (floored <= 0) return 0;
  try {
    return Number(formatSize(floored, szDecimals));
  } catch {
    return 0;
  }
}
