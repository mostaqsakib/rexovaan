// BEP20 / EVM address derivation from an account-level xpub.
// Path from xpub root: m/0/i  (external chain, index i)
// Returns EIP-55 checksummed 0x address.

import { HDKey } from "https://esm.sh/@scure/bip32@1.4.0";
import { keccak_256 } from "https://esm.sh/@noble/hashes@1.4.0/sha3";
import { secp256k1 } from "https://esm.sh/@noble/curves@1.4.0/secp256k1";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eip55(addrLower: string): string {
  const hex = addrLower.toLowerCase().replace(/^0x/, "");
  const hash = toHex(keccak_256(new TextEncoder().encode(hex)));
  let out = "0x";
  for (let i = 0; i < hex.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function deriveAddress(xpub: string, index: number): string {
  const root = HDKey.fromExtendedKey(xpub);
  const child = root.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("no pubkey");
  // Uncompressed pubkey → drop 0x04 prefix → keccak256 → last 20 bytes.
  const uncompressed = secp256k1.ProjectivePoint.fromHex(child.publicKey).toRawBytes(false);
  const hashed = keccak_256(uncompressed.slice(1));
  const addrLower = "0x" + toHex(hashed.slice(-20));
  return eip55(addrLower);
}

export function deriveAddressWithXprv(xprv: string, index: number): { address: string; privateKey: string } {
  const root = HDKey.fromExtendedKey(xprv);
  const child = root.derive(`m/0/${index}`);
  if (!child.publicKey || !child.privateKey) throw new Error("no keys");
  const uncompressed = secp256k1.ProjectivePoint.fromHex(child.publicKey).toRawBytes(false);
  const hashed = keccak_256(uncompressed.slice(1));
  const addrLower = "0x" + toHex(hashed.slice(-20));
  return { address: eip55(addrLower), privateKey: "0x" + toHex(child.privateKey) };
}

// BEP20 contract addresses (BSC mainnet)
export const BEP20_TOKENS = {
  USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
} as const;

export type BEP20TokenSymbol = keyof typeof BEP20_TOKENS;

export function tokenBySymbol(sym: string): { symbol: BEP20TokenSymbol; address: string; decimals: number } | null {
  const s = sym.toUpperCase() as BEP20TokenSymbol;
  if (!(s in BEP20_TOKENS)) return null;
  return { symbol: s, ...BEP20_TOKENS[s] };
}

export function tokenByContract(addrLower: string): { symbol: BEP20TokenSymbol; address: string; decimals: number } | null {
  const a = addrLower.toLowerCase();
  for (const [sym, cfg] of Object.entries(BEP20_TOKENS)) {
    if (cfg.address.toLowerCase() === a) return { symbol: sym as BEP20TokenSymbol, ...cfg };
  }
  return null;
}

// Transfer(address,address,uint256) topic0
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function padTopicAddress(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function topicAddressToHex(topic: string): string {
  return "0x" + topic.slice(-40).toLowerCase();
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
