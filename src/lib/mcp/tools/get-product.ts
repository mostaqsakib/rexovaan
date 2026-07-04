import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_product",
  title: "Get product",
  description: "Get full details for a single product by short_code or id.",
  inputSchema: {
    code: z.string().describe("Product short_code (preferred) or UUID id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ code }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const isUuid = /^[0-9a-f-]{36}$/i.test(code);
    const { data, error } = await supabase
      .from("bot_products")
      .select("id,name,short_code,description,price,currency,last_known_stock,is_active,delivery_instruction")
      .eq(isUuid ? "id" : "short_code", code)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Product not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { product: data },
    };
  },
});
