import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64url.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface StockRequestItem {
  id?: string;
  sheetTab: string;
  soldColumn: string;
  soldValue: string;
}

interface StockCacheEntry {
  stock: number;
  fetchedAt: number;
}

interface SheetMetadataResponse {
  sheets?: Array<{ properties: { title: string; sheetId: number } }>;
}

interface SheetValuesResponse {
  values?: string[][];
}

const STOCK_CACHE_TTL_MS = 30_000;
const STALE_STOCK_CACHE_TTL_MS = 5 * 60_000;
const SHEETS_RETRY_DELAYS_MS = [400, 1200];

const stockCache = new Map<string, StockCacheEntry>();
const inFlightStockRequests = new Map<string, Promise<number>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStockCacheKey({ sheetTab, soldColumn, soldValue }: StockRequestItem): string {
  return JSON.stringify([
    sheetTab.trim().toLowerCase(),
    soldColumn.trim().toLowerCase(),
    soldValue.trim().toUpperCase(),
  ]);
}

function getCachedStock(item: StockRequestItem, maxAgeMs = STOCK_CACHE_TTL_MS): number | null {
  const entry = stockCache.get(getStockCacheKey(item));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return entry.stock;
}

function setCachedStock(item: StockRequestItem, stock: number) {
  stockCache.set(getStockCacheKey(item), { stock, fetchedAt: Date.now() });
}

function getSheetRange(sheetTab: string): string {
  return `'${sheetTab}'`;
}

function countUnsoldRows(rows: string[][], soldColumn: string, soldValue: string): number {
  if (rows.length === 0) return 0;

  const headers = rows[0];
  let soldColIndex = headers.findIndex(
    (h: string) => h.trim().toLowerCase() === soldColumn.trim().toLowerCase()
  );

  const headerless = soldColIndex === -1;
  if (headerless) {
    soldColIndex = 1;
  }

  const startRow = headerless ? 0 : 1;
  let unsoldCount = 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row[0] || !row[0].trim()) continue;
    const cellValue = (row[soldColIndex] || "").trim().toUpperCase();
    if (cellValue !== soldValue.trim().toUpperCase()) {
      unsoldCount++;
    }
  }

  return unsoldCount;
}

function getUnsoldStockDetails(rows: string[][], detailColumns: string[], soldColumn: string, soldValue: string) {
  if (rows.length === 0) return [];

  const headers = rows[0];
  let soldColIndex = headers.findIndex(
    (h: string) => h.trim().toLowerCase() === soldColumn.trim().toLowerCase()
  );

  const headerless = soldColIndex === -1;
  if (headerless) soldColIndex = 1;

  const startRow = headerless ? 0 : 1;
  const detailColIndexes = detailColumns.length > 0
    ? detailColumns.map((col) => ({
        name: col,
        index: headerless ? 0 : headers.findIndex((h: string) => h.trim().toLowerCase() === col.trim().toLowerCase()),
      }))
    : [{ name: "Delivery Info", index: 0 }];

  const items: Array<Record<string, string>> = [];
  const seen = new Set<string>();

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row[0] || !row[0].trim()) continue;
    const cellValue = (row[soldColIndex] || "").trim().toUpperCase();
    if (cellValue === soldValue.trim().toUpperCase()) continue;

    const details: Record<string, string> = {};
    for (const { name, index } of detailColIndexes) {
      if (index !== -1) details[name] = row[index] || "";
    }
    const key = JSON.stringify(details).toLowerCase();
    if (!seen.has(key) && Object.values(details).some((value) => value.trim())) {
      seen.add(key);
      items.push(details);
    }
  }

  return items;
}

function toBase64Url(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return base64Encode(new TextEncoder().encode(input).buffer as ArrayBuffer);
  }
  return base64Encode(new Uint8Array(input).buffer as ArrayBuffer);
}

async function getAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = toBase64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: serviceAccount.token_uri,
      exp: now + 3600,
      iat: now,
    })
  );

  const unsignedToken = `${header}.${claim}`;

  // Import the private key
  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const decodedKey = base64Decode(pemContents);
  const binaryKey = new Uint8Array(decodedKey).buffer as ArrayBuffer;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedToken = `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}`;

  const tokenResponse = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedToken}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function sheetsRequest(
  accessToken: string,
  spreadsheetId: string,
  path: string,
  method = "GET",
  body?: unknown
) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= SHEETS_RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, options);
    const raw = await res.text();
    let data: unknown = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (res.ok) return data;

    lastError = new Error(`Sheets API [${res.status}]: ${JSON.stringify(data)}`);

    if (res.status === 429 && attempt < SHEETS_RETRY_DELAYS_MS.length) {
      await sleep(SHEETS_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new Error("Sheets API request failed");
}

async function batchGetSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTabs: string[]
) {
  const ranges = sheetTabs
    .map((sheetTab) => `ranges=${encodeURIComponent(getSheetRange(sheetTab))}`)
    .join("&");

  return sheetsRequest(accessToken, spreadsheetId, `/values:batchGet?${ranges}`);
}

async function getStockForItem(
  accessToken: string,
  spreadsheetId: string,
  item: StockRequestItem
) {
  const freshStock = getCachedStock(item);
  if (freshStock !== null) {
    return { stock: freshStock, cached: true, stale: false };
  }

  const cacheKey = getStockCacheKey(item);
  const existingRequest = inFlightStockRequests.get(cacheKey);
  if (existingRequest) {
    try {
      return { stock: await existingRequest, cached: false, stale: false };
    } catch (error) {
      const staleStock = getCachedStock(item, STALE_STOCK_CACHE_TTL_MS);
      if (staleStock !== null) {
        return { stock: staleStock, cached: true, stale: true };
      }
      throw error;
    }
  }

  const requestPromise = (async () => {
    const data = await sheetsRequest(
      accessToken,
      spreadsheetId,
      `/values/${encodeURIComponent(getSheetRange(item.sheetTab))}`
    );
    const stock = countUnsoldRows((data as { values?: string[][] }).values || [], item.soldColumn, item.soldValue);
    setCachedStock(item, stock);
    return stock;
  })();

  inFlightStockRequests.set(cacheKey, requestPromise);

  try {
    return { stock: await requestPromise, cached: false, stale: false };
  } catch (error) {
    const staleStock = getCachedStock(item, STALE_STOCK_CACHE_TTL_MS);
    if (staleStock !== null) {
      return { stock: staleStock, cached: true, stale: true };
    }
    throw error;
  } finally {
    inFlightStockRequests.delete(cacheKey);
  }
}

async function getStocksForItems(
  accessToken: string,
  spreadsheetId: string,
  items: StockRequestItem[]
) {
  const stockByKey = new Map<string, number>();
  const pendingItems: StockRequestItem[] = [];

  for (const item of items) {
    const cachedStock = getCachedStock(item);
    if (cachedStock !== null) {
      stockByKey.set(getStockCacheKey(item), cachedStock);
    } else {
      pendingItems.push(item);
    }
  }

  if (pendingItems.length > 0) {
    try {
      const data = await batchGetSheetValues(
        accessToken,
        spreadsheetId,
        pendingItems.map((item) => item.sheetTab)
      );
      const valueRanges = (data as { valueRanges?: Array<{ values?: string[][] }> }).valueRanges || [];

      pendingItems.forEach((item, index) => {
        const stock = countUnsoldRows(valueRanges[index]?.values || [], item.soldColumn, item.soldValue);
        stockByKey.set(getStockCacheKey(item), stock);
        setCachedStock(item, stock);
      });

      return {
        stocks: items.map((item) => ({ id: item.id, stock: stockByKey.get(getStockCacheKey(item)) ?? 0 })),
        unavailableIds: [],
        cached: false,
        stale: false,
      };
    } catch (error) {
      const unavailableIds: string[] = [];

      for (const item of pendingItems) {
        const staleStock = getCachedStock(item, STALE_STOCK_CACHE_TTL_MS);
        if (staleStock !== null) {
          stockByKey.set(getStockCacheKey(item), staleStock);
        } else if (item.id) {
          unavailableIds.push(item.id);
        }
      }

      const stocks = items
        .filter((item) => stockByKey.has(getStockCacheKey(item)))
        .map((item) => ({ id: item.id, stock: stockByKey.get(getStockCacheKey(item)) ?? 0 }));

      if (stocks.length > 0 || unavailableIds.length > 0) {
        return { stocks, unavailableIds, cached: true, stale: true };
      }

      throw error;
    }
  }

  return {
    stocks: items.map((item) => ({ id: item.id, stock: stockByKey.get(getStockCacheKey(item)) ?? 0 })),
    unavailableIds: [],
    cached: true,
    stale: false,
  };
}

import { requireAdmin } from "../_shared/require-admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  try {

    const serviceAccountRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!serviceAccountRaw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");

    const spreadsheetId = Deno.env.get("GOOGLE_SPREADSHEET_ID");
    if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_ID not configured");

    const serviceAccount: ServiceAccountKey = JSON.parse(serviceAccountRaw);
    const accessToken = await getAccessToken(serviceAccount);

    const { action, ...params } = await req.json();

    if (action === "get-tabs") {
      // Return all sheet tab names with their GIDs
      const meta = await sheetsRequest(accessToken, spreadsheetId, "?fields=sheets.properties(title,sheetId)") as SheetMetadataResponse;
      const tabs = (meta.sheets || []).map((s: { properties: { title: string; sheetId: number } }) => ({
        title: s.properties.title,
        gid: s.properties.sheetId,
      }));
      // Also return flat list for backward compat
      return new Response(JSON.stringify({ tabs: tabs.map((t: { title: string; gid: number }) => t.title), tabsWithGid: tabs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync-tab-names") {
      // Given an array of { gid, currentName }, return updated names
      const { items } = params as { items: { gid: number; currentName: string }[] };
      const meta = await sheetsRequest(accessToken, spreadsheetId, "?fields=sheets.properties(title,sheetId)") as SheetMetadataResponse;
      const sheetMap = new Map<number, string>();
      for (const s of (meta.sheets || [])) {
        sheetMap.set(s.properties.sheetId, s.properties.title);
      }
      const updates: { gid: number; oldName: string; newName: string }[] = [];
      for (const item of items) {
        const actualName = sheetMap.get(item.gid);
        if (actualName && actualName !== item.currentName) {
          updates.push({ gid: item.gid, oldName: item.currentName, newName: actualName });
        }
      }
      return new Response(JSON.stringify({ updates }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get-headers") {
      const { sheetTab } = params;
      const range = `'${sheetTab}'!1:1`;
      const data = await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}`) as SheetValuesResponse;
      const headers = (data.values && data.values[0]) || [];
      return new Response(JSON.stringify({ headers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get-stock") {
      const { stock, cached, stale } = await getStockForItem(
        accessToken,
        spreadsheetId,
        params as StockRequestItem
      );

      return new Response(JSON.stringify({ stock, cached, stale }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get-stocks") {
      const products = Array.isArray((params as { products?: StockRequestItem[] }).products)
        ? ((params as { products?: StockRequestItem[] }).products as StockRequestItem[])
        : [];

      const result = await getStocksForItems(accessToken, spreadsheetId, products);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "migrate-to-internal") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseKey) throw new Error("Backend credentials not configured");
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { products } = params as { products?: Array<StockRequestItem & { detailColumns?: string[] }> };
      const targets = Array.isArray(products) ? products : [];
      const summary: Array<{ id?: string; added: number; duplicates: number; found: number }> = [];

      for (const product of targets) {
        if (!product.id) continue;
        const data = await sheetsRequest(
          accessToken,
          spreadsheetId,
          `/values/${encodeURIComponent(getSheetRange(product.sheetTab))}`
        ) as SheetValuesResponse;
        const details = getUnsoldStockDetails(data.values || [], product.detailColumns || [], product.soldColumn, product.soldValue);
        if (details.length === 0) {
          await supabase.from("bot_products").update({ stock_source: "internal", last_known_stock: 0 }).eq("id", product.id);
          summary.push({ id: product.id, added: 0, duplicates: 0, found: 0 });
          continue;
        }

        const { data: inserted, error } = await supabase
          .from("bot_product_stock_items")
          .upsert(
            details.map((item) => ({ product_id: product.id, data: item, status: "available" })),
            { onConflict: "product_id,stock_fingerprint", ignoreDuplicates: true }
          )
          .select("id");
        if (error) throw error;

        const added = inserted?.length || 0;
        await supabase.from("bot_products").update({ stock_source: "internal", last_known_stock: details.length }).eq("id", product.id);
        summary.push({ id: product.id, added, duplicates: details.length - added, found: details.length });
      }

      return new Response(JSON.stringify({ success: true, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "place-order") {
      const { sheetTab, soldColumn, soldValue, detailColumns, quantity } = params;
      const range = `'${sheetTab}'`;
      const data = await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}`) as SheetValuesResponse;
      const rows: string[][] = data.values || [];

      if (rows.length < 2) {
        return new Response(JSON.stringify({ error: "No data rows found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const headers = rows[0];
      let soldColIndex = headers.findIndex(
        (h: string) => h.trim().toLowerCase() === soldColumn.trim().toLowerCase()
      );

      const headerless = soldColIndex === -1;
      if (headerless) {
        soldColIndex = 1; // Column B
      }

      const startRow = headerless ? 0 : 1;

      const detailColIndexes = (detailColumns as string[]).map((col) => {
        const idx = headers.findIndex((h: string) => h.trim().toLowerCase() === col.trim().toLowerCase());
        return { name: col, index: headerless ? 0 : idx }; // For headerless, use column A
      });

      const unsoldRows: { rowIndex: number; rowData: string[] }[] = [];
      for (let i = startRow; i < rows.length; i++) {
        if (!rows[i][0] || !rows[i][0].trim()) continue;
        const cellValue = (rows[i][soldColIndex] || "").trim().toUpperCase();
        if (cellValue !== soldValue.trim().toUpperCase()) {
          unsoldRows.push({ rowIndex: i, rowData: rows[i] });
          if (unsoldRows.length >= quantity) break;
        }
      }

      if (unsoldRows.length < quantity) {
        return new Response(
          JSON.stringify({ error: `Only ${unsoldRows.length} items available, requested ${quantity}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rowNumbers = unsoldRows.map(({ rowIndex }) => rowIndex + 1);
      const orderDetails = unsoldRows.map(({ rowData }) => {
        const details: Record<string, string> = {};
        for (const { name, index } of detailColIndexes) {
          if (index !== -1) details[name] = rowData[index] || "";
        }
        return details;
      });

      const soldColLetter = String.fromCharCode(65 + soldColIndex);
      const updateData = unsoldRows.map(({ rowIndex }) => ({
        range: `'${sheetTab}'!${soldColLetter}${rowIndex + 1}`,
        values: [[soldValue]],
      }));

      await sheetsRequest(accessToken, spreadsheetId, `/values:batchUpdate`, "POST", {
        valueInputOption: "RAW",
        data: updateData,
      });

      let remainingStock = 0;
      for (let i = startRow; i < rows.length; i++) {
        if (!rows[i][0] || !rows[i][0].trim()) continue;
        if (unsoldRows.some((u) => u.rowIndex === i)) continue;
        const cellValue = (rows[i][soldColIndex] || "").trim().toUpperCase();
        if (cellValue !== soldValue.trim().toUpperCase()) {
          remainingStock++;
        }
      }

      return new Response(
        JSON.stringify({ success: true, details: orderDetails, rowNumbers, remainingStock }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "restore-order") {
      const { sheetTab, soldColumn, rowNumbers } = params;
      const headers_row = `'${sheetTab}'!1:1`;
      const hData = await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(headers_row)}`) as SheetValuesResponse;
      const headers = (hData.values && hData.values[0]) || [];
      let soldColIndex = headers.findIndex(
        (h: string) => h.trim().toLowerCase() === soldColumn.trim().toLowerCase()
      );
      if (soldColIndex === -1) {
        soldColIndex = 1; // Fallback to column B for headerless sheets
      }
      const soldColLetter = String.fromCharCode(65 + soldColIndex);
      // Use clear endpoint to preserve data validation (dropdown)
      const ranges = (rowNumbers as number[]).map(
        (row: number) => `'${sheetTab}'!${soldColLetter}${row}`
      );
      await sheetsRequest(
        accessToken,
        spreadsheetId,
        `/values:batchClear`,
        "POST",
        { ranges }
      );
      return new Response(
        JSON.stringify({ success: true, restoredCount: rowNumbers.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
