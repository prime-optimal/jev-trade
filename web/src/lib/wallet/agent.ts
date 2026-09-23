import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { CancelParameters, OrderParameters, UpdateLeverageParameters } from "@nktkas/hyperliquid/api/exchange";
import type { AbstractViemLocalAccount } from "@nktkas/hyperliquid/signing";
import { createWalletClient, custom, defineChain, type PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORK_ENDPOINTS, networkIdentity, type TradingNetwork } from "../trading/networks";
import { normalizeAccounts, normalizeChain, walletError, type Address, type WalletAdapter } from "./provider";

export const AGENT_LIFETIME_MS = 60 * 60 * 1000;
export const AGENT_STOP_LEAD_MS = 30_000;
export interface AgentMetadata {
  owner: Address;
  network: TradingNetwork;
  address: Address;
  name: string;
  expiresAt: number;
}
export function agentMetadataKey(owner: Address, network: TradingNetwork) {
  return `jev:agent:${network}:${owner.toLowerCase()}`;
}
export function matchesAgent(metadata: AgentMetadata, agent: { address: string; name: string; validUntil: number | null }) {
  return agent.address.toLowerCase() === metadata.address.toLowerCase() && agent.validUntil === metadata.expiresAt &&
    (agent.name === metadata.name || agent.name === "Jev Trade") && metadata.name === `Jev Trade valid_until ${metadata.expiresAt}`;
}
export function authorizationDisclosure(owner: Address, network: TradingNetwork) {
  return {
    owner, network, lifetimeMs: AGENT_LIFETIME_MS,
    managementUrl: network === "testnet" ? "https://app.hyperliquid-testnet.xyz/API" : "https://app.hyperliquid.xyz/API",
    message: "Authorize one hour of trading across all selected assets on this shared Hyperliquid account. Other tabs and apps share its positions and margin. The signing key stays in this browser session and is lost on reload. The agent has broad trading permission, not an asset or budget restriction. Malicious page scripts or XSS can trade with it. End session deletes the local signer after owned-order cleanup; it does not revoke the on-chain approval. Review or remove approval on Hyperliquid's API page.",
  };
}
/** Explicit network setup click, separate from Connect and Authorize trading. */
export async function prepareNetworkFromClick(wallet: WalletAdapter, network: TradingNetwork) {
  const identity = networkIdentity(network);
  const initial = wallet.snapshot();
  if (!initial.owner) throw new Error("Connect a wallet first.");
  const checkOwner = () => {
    if (wallet.snapshot().owner !== initial.owner || !wallet.snapshot().connected) throw new Error("Wallet changed during network setup. Retry.");
  };
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: identity.signatureChainId }] });
    checkOwner();
  } catch (error) {
    checkOwner();
    if (walletError(error).code !== 4902) throw error;
    await wallet.request({ method: "wallet_addEthereumChain", params: [{ chainId: identity.signatureChainId, chainName: identity.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [identity.rpcUrl], blockExplorerUrls: [identity.blockExplorerUrl] }] });
    checkOwner();
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: identity.signatureChainId }] });
    checkOwner();
  }
  const chain = await wallet.request({ method: "eth_chainId" });
  checkOwner();
  if (normalizeChain(chain) !== identity.signatureChainId) throw new Error("Select the requested wallet network and Retry.");
}
export interface AgentOptions {
  wallet: WalletAdapter;
  network: TradingNetwork;
  /** Public metadata only. Omit when storage is unavailable. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  onStop: () => void;
  now?: () => number;
}
/** Create only in a client effect. Never put this controller or its signer in React state. */
export function createAgentSession(options: AgentOptions) {
  const { wallet } = options;
  const now = options.now ?? Date.now;
  let network = options.network;
  let epoch = 0;
  let pending = false;
  let ended = false;
  let stopping = false;
  let signer: PrivateKeyAccount | null = null;
  let client: ExchangeClient | null = null;
  let metadata: AgentMetadata | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const destroy = () => {
    epoch++;
    signer = null;
    client = null;
    metadata = null;
    clearTimeout(stopTimer);
    clearTimeout(expiryTimer);
  };
  const unsubscribe = wallet.subscribe(() => { destroy(); options.onStop(); });
  const current = () => {
    if (metadata && now() >= metadata.expiresAt) { destroy(); options.onStop(); }
    if (metadata && now() >= metadata.expiresAt - AGENT_STOP_LEAD_MS && !stopping) { stopping = true; options.onStop(); }
    return metadata ? { ...metadata } : null;
  };
  return {
    metadata: current,
    setNetwork(next: TradingNetwork) {
      if (next !== network) { network = next; destroy(); options.onStop(); }
    },
    replacementRequired() {
      const owner = wallet.snapshot().owner;
      if (metadata) return true;
      if (!owner) return false;
      try { return Boolean(options.storage?.getItem(agentMetadataKey(owner, network))); } catch { return false; }
    },
    async authorizeFromClick({ replace = false }: { replace?: boolean } = {}) {
      if (ended || pending) throw new Error("Approval unavailable or already pending.");
      if (this.replacementRequired() && !replace) throw new Error("Explicit replacement is required. Reload cannot restore an agent key.");
      destroy();
      stopping = false;
      pending = true;
      const captured = wallet.snapshot();
      const selectedNetwork = network;
      const selectedProvider = wallet.provider;
      const generation = epoch;
      const identity = networkIdentity(selectedNetwork);
      const expiresAt = now() + AGENT_LIFETIME_MS;
      const check = () => {
        const latest = wallet.snapshot();
        if (ended || generation !== epoch || selectedNetwork !== network || selectedProvider !== wallet.provider || !latest.connected || latest.owner !== captured.owner || latest.epoch !== captured.epoch || latest.chainId !== identity.signatureChainId || now() >= expiresAt) {
          throw new Error("Wallet session changed or authorization expired. Retry with a fresh approval.");
        }
      };
      try {
        check();
        if (!captured.owner) throw new Error("Connect a wallet first.");
        const accounts = await wallet.request({ method: "eth_accounts" });
        check();
        if (normalizeAccounts(accounts)[0] !== captured.owner) throw new Error("Wallet account changed. Reconnect.");
        const chainId = await wallet.request({ method: "eth_chainId" });
        check();
        if (normalizeChain(chainId) !== identity.signatureChainId) throw new Error("Set up the selected wallet network first.");
        const chain = defineChain({ id: identity.chainId, name: identity.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [identity.rpcUrl] } } });
        const ownerWallet = createWalletClient({ account: captured.owner, chain, transport: custom({
          async request(args) {
            check();
            const response = await wallet.request(args);
            check();
            return response;
          },
        }, { retryCount: 0 }) });
        // No private-key string is retained outside the account's private closure.
        signer = privateKeyToAccount(generatePrivateKey());
        const candidate: AgentMetadata = { owner: captured.owner, network: selectedNetwork, address: signer.address.toLowerCase() as Address, expiresAt, name: `Jev Trade valid_until ${expiresAt}` };
        const http = new HttpTransport({ isTestnet: selectedNetwork === "testnet", apiUrl: NETWORK_ENDPOINTS[selectedNetwork].apiUrl });
        const transport: HttpTransport = Object.assign(Object.create(http), {
          request: async (...args: Parameters<HttpTransport["request"]>) => {
            check();
            const response = await http.request(...args);
            check();
            return response;
          },
        });
        const ownerClient = new ExchangeClient({ wallet: ownerWallet, transport, signatureChainId: identity.signatureChainId });
        await ownerClient.approveAgent({ agentAddress: candidate.address, agentName: candidate.name });
        check();
        const agents = await new InfoClient({ transport }).extraAgents({ user: candidate.owner });
        check();
        if (!agents.some(agent => matchesAgent(candidate, agent))) throw new Error("Approval could not be confirmed. Retry with a fresh replacement.");
        // SDK sees only a guarded signing function, never the underlying account or private key.
        const guardedSigner: AbstractViemLocalAccount = {
          address: candidate.address,
          async signTypedData(data) {
            check();
            if (!signer) throw new Error("Agent signer was destroyed.");
            const signature = await signer.signTypedData(data);
            check();
            if (!signer) throw new Error("Agent signer was destroyed.");
            return signature;
          },
        };
        client = new ExchangeClient({ wallet: guardedSigner, transport, signatureChainId: identity.signatureChainId });
        metadata = candidate;
        try { options.storage?.setItem(agentMetadataKey(candidate.owner, selectedNetwork), JSON.stringify(candidate)); } catch { /* Storage is optional; the key never enters it. */ }
        stopTimer = setTimeout(() => { stopping = true; options.onStop(); }, Math.max(0, expiresAt - now() - AGENT_STOP_LEAD_MS));
        expiryTimer = setTimeout(() => { destroy(); options.onStop(); }, Math.max(0, expiresAt - now()));
        return { ...candidate };
      } catch (error) {
        destroy();
        throw walletError(error);
      } finally { pending = false; }
    },
    async order(params: OrderParameters) {
      if (!current() || !client || stopping) throw new Error("Agent is unavailable or stopping.");
      return await client.order(params);
    },
    async cancel(params: CancelParameters) {
      if (!current() || !client) throw new Error("Agent is unavailable.");
      return await client.cancel(params);
    },
    async updateLeverage(params: UpdateLeverageParameters) {
      if (!current() || !client || stopping) throw new Error("Agent is unavailable or stopping.");
      return await client.updateLeverage(params);
    },
    /** Call after owned-order cleanup. This does not revoke the Hyperliquid approval. */
    endSession() { ended = true; destroy(); unsubscribe(); },
  };
}
