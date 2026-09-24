import type { EvaluationEvidence, GroupResult, ProgramRecordType } from "./jev-evidence";
import type { ModelDecision } from "./model";
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
    recordType: ProgramRecordType;
    late: boolean;
    model: string;
    provider: string;
    modelId: string;
    evidence: EvaluationEvidence;
    decision: ModelDecision | null;
    position: Position;
    totals: Totals;
  })
  | (JournalBase & {
    type: "decision-observation";
    recordType: ProgramRecordType;
    revision: string;
    groupId: string;
    completion: GroupResult;
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
