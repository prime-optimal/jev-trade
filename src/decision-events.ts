import type { JevPrompt, ModelDecision } from "./model";
import type { Fill, Position, Quote, Totals } from "./types";

type JournalBase = {
  decisionId: string;
  runId: string | null;
  coin: string;
  market: string;
  timestamp: number;
  block: number;
};

export type DecisionJournalEvent =
  | (JournalBase & {
    type: "decision";
    late: boolean;
    model: string;
    provider: string;
    modelId: string;
    promptRevision: string;
    prompt: JevPrompt;
    decision: ModelDecision;
    position: Position;
    totals: Totals;
  })
  | (JournalBase & {
    type: "quote";
    quote: Quote;
  })
  | (JournalBase & {
    type: "fill";
    fillId: string;
    fill: Fill;
    position: Position;
    totals: Totals;
  })
  | (JournalBase & {
    type: "markout";
    horizonTicks: 1 | 5 | 20 | 100;
    observedBlock: number;
    observedTimestamp: number;
    observedMid: number;
    signedReturnBps: number;
    marketReturnBps: number;
  });

export interface DecisionJournal {
  enqueue(event: DecisionJournalEvent): void;
}
