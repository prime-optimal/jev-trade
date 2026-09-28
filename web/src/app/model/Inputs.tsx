import type { GroupSnapshot } from "@/lib/journal-types";
import { IndicatorsCard, PositionCard, VenueCard } from "./ContextCards";
import Fields from "./Fields";
import InputCard from "./InputCard";
import { BookCard, DepthCard, FlowCard, PriceCard, PrintsCard } from "./MarketCards";
import { capturedFeatures, type DecisionSummary } from "./record";
import styles from "./inputs.module.css";

const RENDERED = new Set(["coin", "market", "tick", "tickMs", "mid", "spreadBps", "bookImbalance", "returnsBps", "recentMids", "book", "depth", "trades", "recentTrades", "indicators", "asset", "maxLeverage", "position"]);

export default function Inputs({ snapshots, summary }: { snapshots: readonly GroupSnapshot[]; summary: DecisionSummary }) {
  const features = capturedFeatures(snapshots);
  const get = (id: string) => features.get(id);
  const others = [...features.values()].filter((feature) => !RENDERED.has(feature.id));
  const captured = snapshots[0];
  return <div className={styles.inputs}>
    <p className={styles.caption}>
      {captured ? <>Captured {new Date(captured.capturedAt).toLocaleTimeString()} from catalog {captured.catalogVersion}. </> : null}
      {snapshots.map((snapshot) => `${snapshot.groupId} read ${Object.keys(snapshot.state ?? {}).length}`).join(", ")} inputs.
    </p>
    <div className={styles.grid}>
      {get("mid") || get("recentMids") || get("returnsBps") ? <PriceCard mid={get("mid")} spread={get("spreadBps")} imbalance={get("bookImbalance")} returns={get("returnsBps")} mids={get("recentMids")} indicators={get("indicators")} markouts={summary.markouts} /> : null}
      {get("book") ? <BookCard book={get("book")} spread={get("spreadBps")} mid={get("mid")} /> : null}
      {get("depth") ? <DepthCard depth={get("depth")} imbalance={get("bookImbalance")} /> : null}
      {get("trades") ? <FlowCard trades={get("trades")} /> : null}
      {get("recentTrades") ? <PrintsCard prints={get("recentTrades")} tick={get("tick")} /> : null}
      {get("indicators") ? <IndicatorsCard indicators={get("indicators")} mid={get("mid")} /> : null}
      {get("position") ? <PositionCard position={get("position")} coin={summary.coin} /> : null}
      {get("asset") || get("maxLeverage") ? <VenueCard asset={get("asset")} maxLeverage={get("maxLeverage")} /> : null}
      {others.length ? <InputCard title="Other inputs" features={others}><Fields value={Object.fromEntries(others.map((feature) => [feature.id, feature.value]))} /></InputCard> : null}
    </div>
  </div>;
}
