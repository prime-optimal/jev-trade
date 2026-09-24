import { PROGRAM_RECORD_TYPE, type EvaluationEvidence, type GroupResult } from "./jev-evidence";
import { safeTransportMessage } from "./hyperliquid";
import type { ModelDecision } from "./model";
import type { DecisionJournal, DecisionJournalEvent } from "./decision-events";
import type { Position, Totals } from "./types";

export interface DecisionJournalInput {
  decisionId: string;
  runId: string | null;
  coin: string;
  market: string;
  timestamp: number;
  block: number;
  late: boolean;
  model: string;
  provider: string;
  modelId: string;
  evidence: EvaluationEvidence;
  decision: ModelDecision | null;
  position: Position;
  totals: Totals;
}

export interface ScheduledMarkout {
  block: number;
  mid: number;
  runId: string | null;
  direction: -1 | 0 | 1;
  pending: Set<1 | 5 | 20 | 100>;
}

export function enqueueJournal(journal: DecisionJournal | undefined, label: string, event: DecisionJournalEvent) {
  try {
    journal?.enqueue(event);
  } catch (error) {
    console.error(`${label} decision journal:`, safeTransportMessage(error));
  }
}

export function recordDecision(journal: DecisionJournal | undefined, label: string, input: DecisionJournalInput) {
  enqueueJournal(journal, label, { type: "decision", recordType: PROGRAM_RECORD_TYPE, ...input });
}

export function recordObservations(
  journal: DecisionJournal | undefined,
  label: string,
  input: Pick<DecisionJournalInput, "decisionId" | "runId" | "coin" | "market" | "timestamp" | "block"> & {
    revision: string;
    observations: Promise<readonly GroupResult[]>;
  },
): Promise<void> {
  if (!journal) return Promise.resolve();
  return input.observations.then((groups) => {
    for (const completion of groups) {
      enqueueJournal(journal, label, {
        type: "decision-observation",
        recordType: PROGRAM_RECORD_TYPE,
        decisionId: input.decisionId,
        runId: input.runId,
        coin: input.coin,
        market: input.market,
        timestamp: input.timestamp,
        block: input.block,
        revision: input.revision,
        groupId: completion.groupId,
        completion,
      });
    }
  }).catch((error) => {
    console.error(`${label} decision observation:`, safeTransportMessage(error));
  });
}

export function scheduleMarkout(
  markouts: Map<string, ScheduledMarkout>,
  decisionId: string,
  block: number,
  mid: number,
  bias: ModelDecision["bias"],
  runId: string | null,
) {
  markouts.set(decisionId, {
    block,
    runId,
    mid,
    direction: bias === "long" ? 1 : -1,
    pending: new Set([1, 5, 20, 100]),
  });
}

export function emitMarkouts(
  journal: DecisionJournal | undefined,
  label: string,
  coin: string,
  market: string,
  markouts: Map<string, ScheduledMarkout>,
  observations: Map<number, { mid: number; ts: number }>,
) {
  for (const [decisionId, markout] of markouts) {
    for (const horizon of markout.pending) {
      const observedBlock = markout.block + horizon;
      const observed = observations.get(observedBlock);
      if (!observed) continue;
      const marketReturnBps = ((observed.mid - markout.mid) / markout.mid) * 10_000;
      enqueueJournal(journal, label, {
        type: "markout",
        decisionId,
        runId: markout.runId,
        coin,
        market,
        block: markout.block,
        timestamp: observed.ts,
        horizonTicks: horizon,
        observedBlock,
        observedTimestamp: observed.ts,
        observedMid: observed.mid,
        signedReturnBps: marketReturnBps * markout.direction,
        marketReturnBps,
      });
      markout.pending.delete(horizon);
    }
    if (markout.pending.size === 0) markouts.delete(decisionId);
  }
}
