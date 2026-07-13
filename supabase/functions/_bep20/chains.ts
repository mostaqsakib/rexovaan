// Multi-chain EVM registry. All chains share the same xpub-derived address
// (same secp256k1 pubkey → same EVM address on every EVM chain), so we can
// watch and sweep the SAME address on BSC/Polygon/Arbitrum/etc.
//
// Wrong-network recovery = watch all chains, credit whichever one the
// customer accidentally paid on.

export type ChainId = "bsc" | "polygon" | "arbitrum" | "optimism" | "base" | "ethereum" | "avalanche";

export interface TokenCfg {
  symbol: "USDT" | "USDC";
  address: string;   // contract, lowercase-safe
  decimals: number;
}

export interface ChainCfg {
  id: ChainId;
  name: string;
  chainId: number;
  nativeSymbol: string;              // BNB / MATIC / ETH / AVAX
  rpcEnvKey: string;                 // env var holding RPC URL
  defaultRpc?: string;               // public fallback
  confirmations: number;
  chunkSize: number;                 // getLogs range
  minGasNativeWei: bigint;           // low-water mark for gas tank alert
  gasTopUpWei: bigint;               // amount to fund derived address per sweep
  explorerTx: (h: string) => string;
  tokens: TokenCfg[];
}

// USDT/USDC contract addresses across chains (mainnet).
// Sources: official token pages. Bridged variants included for
// wrong-network recovery (USDbC on Base, USDC.e on Polygon/Arb/Op/Avax).
export const CHAINS: Record<ChainId, ChainCfg> = {
  bsc: {
    id: "bsc",
    name: "BNB Smart Chain",
    chainId: 56,
    nativeSymbol: "BNB",
    rpcEnvKey: "BSC_RPC_URL",
    defaultRpc: "https://bsc-dataseed.binance.org",
    confirmations: 3,
    chunkSize: 4000,
    minGasNativeWei: 1_000_000_000_000_000n,   // 0.001 BNB (~$0.70) — alert threshold
    gasTopUpWei:        20_000_000_000_000n,   // 0.00002 BNB — ~2× actual sweep cost @ 0.1 gwei (90k gas = 9e-6 BNB)
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    ],
  },
  polygon: {
    id: "polygon",
    name: "Polygon",
    chainId: 137,
    nativeSymbol: "MATIC",
    rpcEnvKey: "POLYGON_RPC_URL",
    defaultRpc: "https://polygon-rpc.com",
    confirmations: 20,
    chunkSize: 500,
    minGasNativeWei: 200_000_000_000_000_000n, // 0.2 MATIC — alert threshold
    gasTopUpWei:      30_000_000_000_000_000n, // 0.03 MATIC (~$0.02) — enough for a sweep with buffer
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },  // native USDC
      { symbol: "USDC", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },  // USDC.e (bridged)
    ],
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    nativeSymbol: "ETH",
    rpcEnvKey: "ARBITRUM_RPC_URL",
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    confirmations: 1,
    chunkSize: 5000,
    minGasNativeWei:  1_500_000_000_000_000n,  // 0.0015 ETH
    gasTopUpWei:        800_000_000_000_000n,  // 0.0008 ETH
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },   // native
      { symbol: "USDC", address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },   // USDC.e
    ],
  },
  optimism: {
    id: "optimism",
    name: "Optimism",
    chainId: 10,
    nativeSymbol: "ETH",
    rpcEnvKey: "OPTIMISM_RPC_URL",
    defaultRpc: "https://mainnet.optimism.io",
    confirmations: 1,
    chunkSize: 5000,
    minGasNativeWei:  1_500_000_000_000_000n,
    gasTopUpWei:        800_000_000_000_000n,
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },   // native
      { symbol: "USDC", address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", decimals: 6 },   // USDC.e
    ],
  },
  base: {
    id: "base",
    name: "Base",
    chainId: 8453,
    nativeSymbol: "ETH",
    rpcEnvKey: "BASE_RPC_URL",
    defaultRpc: "https://mainnet.base.org",
    confirmations: 1,
    chunkSize: 5000,
    minGasNativeWei:  1_500_000_000_000_000n,
    gasTopUpWei:        800_000_000_000_000n,
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },   // native USDC
      { symbol: "USDC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },   // USDbC (bridged)
    ],
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    nativeSymbol: "ETH",
    rpcEnvKey: "ETH_RPC_URL",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
    confirmations: 6,
    chunkSize: 2000,
    minGasNativeWei:  15_000_000_000_000_000n, // 0.015 ETH (high gas)
    gasTopUpWei:       8_000_000_000_000_000n, // 0.008 ETH
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    ],
  },
  avalanche: {
    id: "avalanche",
    name: "Avalanche C-Chain",
    chainId: 43114,
    nativeSymbol: "AVAX",
    rpcEnvKey: "AVALANCHE_RPC_URL",
    defaultRpc: "https://api.avax.network/ext/bc/C/rpc",
    confirmations: 3,
    chunkSize: 2048,
    minGasNativeWei:   40_000_000_000_000_000n, // 0.04 AVAX
    gasTopUpWei:       20_000_000_000_000_000n, // 0.02 AVAX
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
    tokens: [
      { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
      { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },   // native
      { symbol: "USDC", address: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", decimals: 6 },   // USDC.e
    ],
  },
};

export function getRpcUrl(cfg: ChainCfg): string | null {
  const v = Deno.env.get(cfg.rpcEnvKey);
  if (v && v.length > 8) return v;
  return cfg.defaultRpc ?? null;
}

// Chains hard-disabled (too expensive / unused). Removing the RPC secret would also work,
// but this makes the intent explicit and survives accidental secret re-adds.
const DISABLED_CHAINS: ChainId[] = ["ethereum", "avalanche"];

export function enabledChains(): ChainCfg[] {
  return Object.values(CHAINS).filter((c) => !DISABLED_CHAINS.includes(c.id) && !!getRpcUrl(c));
}

export function tokenByContract(chain: ChainCfg, addrLower: string): TokenCfg | null {
  const a = addrLower.toLowerCase();
  return chain.tokens.find((t) => t.address.toLowerCase() === a) ?? null;
}

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function topicAddressToHex(topic: string): string {
  return "0x" + topic.slice(-40).toLowerCase();
}

export function padTopicAddress(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

export function formatUnits(raw: bigint, decimals: number): number {
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return Number(frac ? `${int}.${frac}` : int);
}
