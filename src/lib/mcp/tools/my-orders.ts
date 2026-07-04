import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "my_orders",
  title: "My orders",
  description: "List the signed-in customer's recent orders.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max rows to return (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: customer } = await supabase
      .from("bot_customers")
      .select("id")
      .eq("auth_user_id", ctx.getUserId())
      .maybeSingle();
    if (!customer) {
      return { content: [{ type: "text", text: "Customer profile not found" }], isError: true };
    }
    const { data, error } = await supabase
      .from("bot_orders")
      .select("id,product_name,quantity,total_price,status,source,created_at,delivered_at")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { orders: data },
    };
  },
});
