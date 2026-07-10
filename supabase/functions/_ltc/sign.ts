// LTC signing helpers — derives private key from account xprv and builds signed P2WPKH tx.
import { HDKey } from "https://esm.sh/@scure/bip32@1.4.0";
import { base58check, bech32 } from "https://esm.sh/@scure/base@1.1.6";
import { sha256 } from "https://esm.sh/@noble/hashes@1.4.0/sha256";
import { ripemd160 } from "https://esm.sh/@noble/hashes@1.4.0/ripemd160";
import * as btc from "https://esm.sh/@scure/btc-signer@1.5.0";

const b58c = base58check(sha256);

// Litecoin network params for @scure/btc-signer
export const LTC_NETWORK = {
  bech32: "ltc",
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

// Normalize any extended PRIVATE key (zprv / Ltpv / Mtpv / yprv) to standard xprv
// so HDKey can parse it. Version bytes for xprv = 0x0488ADE4.
function normalizeToXprv(ext: string): string {
  const decoded = b58c.decode(ext);
  const out = new Uint8Array(decoded.length);
  out.set(decoded, 0);
  out[0] = 0x04; out[1] = 0x88; out[2] = 0xAD; out[3] = 0xE4;
  return b58c.encode(out);
}

export function deriveLtcPrivateKey(xprv: string, index: number): { privKey: Uint8Array; pubKey: Uint8Array; address: string; pkh: Uint8Array } {
  const normalized = normalizeToXprv(xprv);
  const root = HDKey.fromExtendedKey(normalized);
  const child = root.derive(`m/0/${index}`);
  if (!child.privateKey || !child.publicKey) throw new Error("no priv/pub");
  const pkh = hash160(child.publicKey);
  const words = bech32.toWords(pkh);
  const address = bech32.encode("ltc", [0, ...words]);
  return { privKey: child.privateKey, pubKey: child.publicKey, address, pkh };
}

export type Utxo = { txid: string; vout: number; value: number };

// Build & sign a P2WPKH sweep transaction sending all UTXOs to destination minus fee.
// feeRateSatVb: sat/vB.
export function buildAndSignSweep(
  utxos: Utxo[],
  privKey: Uint8Array,
  pubKey: Uint8Array,
  pkh: Uint8Array,
  destAddress: string,
  feeRateSatVb: number,
): { txHex: string; txid: string; feeSats: number; sendSats: number } {
  if (utxos.length === 0) throw new Error("no utxos");

  const tx = new btc.Transaction({ allowUnknownOutputs: false });

  // P2WPKH scriptPubKey = OP_0 <20-byte pkh>
  const scriptPubKey = new Uint8Array(22);
  scriptPubKey[0] = 0x00;
  scriptPubKey[1] = 0x14;
  scriptPubKey.set(pkh, 2);

  const totalIn = utxos.reduce((s, u) => s + u.value, 0);

  for (const u of utxos) {
    tx.addInput({
      txid: u.txid,
      index: u.vout,
      witnessUtxo: { script: scriptPubKey, amount: BigInt(u.value) },
      sighashType: btc.SigHash.ALL,
    });
  }

  // Decode destination bech32 (ltc1...) into scriptPubKey
  const decoded = bech32.decode(destAddress as `${string}1${string}`);
  if (decoded.prefix !== "ltc") throw new Error("dest not ltc");
  const [witver, ...prog] = decoded.words;
  const program = bech32.fromWords(prog);
  if (witver !== 0 || program.length !== 20) throw new Error("only P2WPKH dest supported");
  const destScript = new Uint8Array(2 + program.length);
  destScript[0] = 0x00;
  destScript[1] = program.length;
  destScript.set(program, 2);

  // Estimate size: p2wpkh input ~68 vB, output 31 vB, overhead ~11 vB
  const estVBytes = 11 + utxos.length * 68 + 31;
  const feeSats = Math.max(200, Math.ceil(estVBytes * feeRateSatVb));
  const sendSats = totalIn - feeSats;
  if (sendSats <= 546) throw new Error(`sweep amount too small after fee (in=${totalIn} fee=${feeSats})`);

  tx.addOutput({ script: destScript, amount: BigInt(sendSats) });

  for (let i = 0; i < utxos.length; i++) {
    tx.signIdx(privKey, i);
  }
  tx.finalize();

  const txHex = Array.from(tx.extract()).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { txHex, txid: tx.id, feeSats, sendSats };
}
