import type { TradingNetwork } from "./networks";
export interface OwnerLock { release(): void }
export interface LockProvider {
  acquire(owner: string, network: TradingNetwork): Promise<OwnerLock>;
}
export function createOwnerLocks(manager: LockManager): LockProvider {
  return {
    acquire(owner, network) {
      if (!/^0x[0-9a-f]{40}$/i.test(owner)) return Promise.reject(new Error("Invalid owner"));
      return new Promise<OwnerLock>((resolve, reject) => {
        const name = `jev:trading:${network}:${owner.toLowerCase()}`;
        void manager.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
          if (!lock) { reject(new Error("This account is active in another tab")); return; }
          await new Promise<void>(release => resolve({ release }));
        }).catch(reject);
      });
    },
  };
}
