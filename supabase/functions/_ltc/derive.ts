// LTC (Litecoin) address derivation from account-level xpub.
// Supports BIP84 (zpub → ltc1...), BIP49 (ypub → M...), BIP44 (xpub/Ltub → L...).
// Path from account xpub: m/0/i (external chain, index i)

import { HDKey } from "https://esm.sh/@scure/bip32@1.4.0";
import { bech32 } from "https://esm.sh/@scure/base@1.1.6";
import { sha256 } from "https://esm.sh/@noble/hashes@1.4.0/sha256";
import { ripemd160 } from "https://esm.sh/@noble/hashes@1.4.0/ripemd160";
import { base58check } from "https://esm.sh/@scure/base@1.1.6";

const b58c = base58check(sha256);

export type ScriptType = "bip84" | "bip49" | "bip44";

// Litecoin mainnet params
const LTC_P2PKH_VERSION = 0x30; // L...
const LTC_P2SH_VERSION = 0x32;  // M... (new); 0x05 also historically valid but 0x32 is standard
const LTC_BECH32_HRP = "ltc";

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

// Some HD libs choke on zpub/ypub prefixes because their version bytes aren't
// registered. Convert to xpub (bitcoin mainnet version 0x0488B21E) before feeding to HDKey.
function normalizeToXpub(ext: string): string {
  // Base58Check decode
  const decoded = b58c.decode(ext);
  // Replace first 4 bytes with 0x0488B21E (xpub)
  const out = new Uint8Array(decoded.length);
  out.set(decoded, 0);
  out[0] = 0x04; out[1] = 0x88; out[2] = 0xB2; out[3] = 0x1E;
  return b58c.encode(out);
}

export function detectScriptType(extKey: string): ScriptType {
  const p = extKey.slice(0, 4).toLowerCase();
  if (p === "zpub" || p === "vpub") return "bip84";
  if (p === "ypub" || p === "upub") return "bip49";
  return "bip44"; // xpub, Ltub, tpub
}

export function deriveLtcAddress(extKey: string, index: number, scriptTypeOverride?: ScriptType): string {
  const scriptType = scriptTypeOverride || detectScriptType(extKey);
  const xpub = normalizeToXpub(extKey);
  const root = HDKey.fromExtendedKey(xpub);
  const child = root.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("no pubkey");
  const pubkey = child.publicKey; // compressed 33 bytes
  const pkh = hash160(pubkey);

  if (scriptType === "bip84") {
    // Native segwit P2WPKH: bech32(hrp='ltc', witver=0, program=pkh)
    const words = bech32.toWords(pkh);
    return bech32.encode(LTC_BECH32_HRP, [0, ...words]);
  }

  if (scriptType === "bip49") {
    // Nested segwit P2SH-P2WPKH
    // redeemScript = 0x00 0x14 <pkh>  → hash160 → base58check with P2SH version
    const redeem = new Uint8Array(22);
    redeem[0] = 0x00; redeem[1] = 0x14;
    redeem.set(pkh, 2);
    const scriptHash = hash160(redeem);
    const payload = new Uint8Array(21);
    payload[0] = LTC_P2SH_VERSION;
    payload.set(scriptHash, 1);
    return b58c.encode(payload);
  }

  // BIP44 legacy P2PKH
  const payload = new Uint8Array(21);
  payload[0] = LTC_P2PKH_VERSION;
  payload.set(pkh, 1);
  return b58c.encode(payload);
}
