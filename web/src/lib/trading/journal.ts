export type Cloid = `0x${string}`;
export type OrderState = "pending" | "open" | "unknown" | "filled" | "canceled" | "rejected";
export interface JournalEntry {
  cloid: Cloid;
  asset: number;
  coin: string;
  epoch: number;
  submittedAt: number;
  expiresAfter: number;
  state: OrderState;
  oid?: number;
  cancelPending: boolean;
}
export interface OrderJournal {
  begin(input: Omit<JournalEntry, "cloid" | "state" | "cancelPending">): JournalEntry;
  get(cloid: Cloid): JournalEntry | null;
  update(cloid: Cloid, patch: Partial<Pick<JournalEntry, "state" | "oid" | "cancelPending">>): void;
  all(): JournalEntry[];
  unresolved(): JournalEntry[];
}
export function createOrderJournal(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): OrderJournal {
  const entries = new Map<Cloid, JournalEntry>();
  return {
    begin(input: Omit<JournalEntry, "cloid" | "state" | "cancelPending">): JournalEntry {
      const cloid = `0x${Array.from(random(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}` as Cloid;
      if (!/^0x[0-9a-f]{32}$/.test(cloid) || entries.has(cloid)) throw new Error("Invalid or duplicate order identifier");
      const entry: JournalEntry = { ...input, cloid, state: "pending", cancelPending: false };
      entries.set(cloid, entry);
      return { ...entry };
    },
    get(cloid: Cloid) { const entry = entries.get(cloid); return entry ? { ...entry } : null; },
    update(cloid: Cloid, patch: Partial<Pick<JournalEntry, "state" | "oid" | "cancelPending">>) {
      const entry = entries.get(cloid);
      if (!entry) throw new Error("Order is not owned by this session");
      Object.assign(entry, patch);
    },
    all() { return Array.from(entries.values(), entry => ({ ...entry })); },
    unresolved() { return Array.from(entries.values()).filter(entry => ["pending", "open", "unknown"].includes(entry.state)).map(entry => ({ ...entry })); },
  };
}
