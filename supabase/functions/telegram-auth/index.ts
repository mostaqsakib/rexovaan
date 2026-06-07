import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function validateInitData(initData: string, botToken: string): Promise<{ valid: boolean; user?: any }> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };
    params.delete("hash");
    const entries = Array.from(params.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const encoder = new TextEncoder();
    const secretKeyData = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const secretKey = await crypto.subtle.sign("HMAC", secretKeyData, encoder.encode(botToken));
    const key = await crypto.subtle.importKey("raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(dataCheckString));
    const hexHash = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hexHash !== hash) return { valid: false };

    const authDate = parseInt(params.get("auth_date") || "0");
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return { valid: false };

    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;
    return { valid: true, user };
  } catch (e) {
    console.error("Validation error:", e);
    return { valid: false };
  }
}

async function validateLaunchToken(token: string): Promise<{ valid: boolean; user?: any }> {
  try {
    const [payloadBase64, signature] = token.split(".");
    if (!payloadBase64 || !signature) return { valid: false };
    const signingSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!signingSecret) return { valid: false };
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadBase64));
    const expectedSignature = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (expectedSignature !== signature) return { valid: false };
    const json = new TextDecoder().decode(Uint8Array.from(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json);
    if (!payload.chat_id || !payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return { valid: false };
    return { valid: true, user: { id: payload.chat_id, first_name: "Admin" } };
  } catch (e) {
    console.error("Launch token validation error:", e);
    return { valid: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { initData, launchToken } = await req.json();

    let authResult: { valid: boolean; user?: any } = { valid: false };

    if (initData) {
      const BOT_TOKEN = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"));
      if (BOT_TOKEN) authResult = await validateInitData(initData, BOT_TOKEN);
    }
    if ((!authResult.valid || !authResult.user) && launchToken) {
      authResult = await validateLaunchToken(launchToken);
    }

    if (!authResult.valid || !authResult.user) {
      return new Response(JSON.stringify({ error: "Invalid auth", authorized: false }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
    const isAdmin = adminChatId ? String(authResult.user.id) === String(adminChatId) : false;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Not authorized", authorized: false }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mint a Supabase session for the admin user via magic-link token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Find the admin user email by joining user_roles -> auth.users
    const { data: roleRow, error: roleErr } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (roleErr || !roleRow) {
      return new Response(JSON.stringify({ error: "No admin user provisioned", authorized: false }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userInfo, error: userErr } = await admin.auth.admin.getUserById(roleRow.user_id);
    if (userErr || !userInfo?.user?.email) {
      return new Response(JSON.stringify({ error: "Admin user lookup failed", authorized: false }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminEmail = userInfo.user.email;
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: adminEmail,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("generateLink error:", linkErr);
      return new Response(JSON.stringify({ error: "Could not mint session", authorized: false }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        authorized: true,
        user: {
          id: authResult.user.id,
          first_name: authResult.user.first_name,
          username: authResult.user.username,
        },
        token_hash: linkData.properties.hashed_token,
        email: adminEmail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Auth error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
