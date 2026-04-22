// supabase/functions/pocketfi-mall-webhook/index.ts
// Handles PocketFi payment webhooks for Magic Mall.
// Uses profiles2 table and credit_wallet_from_webhook2 RPC.
//
// POST /pocketfi-mall-webhook — receives webhook, verifies signature, credits wallet.
// GET  /pocketfi-mall-webhook — health check.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "ok", message: "PocketFi Mall webhook endpoint active" });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const rawBody = await req.text();
    console.log("=== POCKETFI MALL WEBHOOK RECEIVED ===");
    console.log("Raw body:", rawBody);
    console.log("Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

    // ── Step 1: Verify webhook signature ──
    const secretKey = Deno.env.get("POCKETFI_MALL_SECRET_KEY");
    const signatureHeader =
      req.headers.get("pocketfi_signature") ||
      req.headers.get("x-pocketfi-signature") ||
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-signature") ||
      req.headers.get("signature");

    if (secretKey && signatureHeader) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secretKey),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
      const computedHex = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (computedHex !== signatureHeader.toLowerCase()) {
        console.error("Signature mismatch! computed:", computedHex, "received:", signatureHeader);
        return jsonResponse({ status: "signature_mismatch" });
      }
      console.log("Webhook signature verified ✅");
    } else {
      console.log("No signature header found — accepting webhook without verification");
    }

    // ── Step 2: Parse payload ──
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error("Invalid JSON payload");
      return jsonResponse({ status: "invalid_json" });
    }

    console.log("Parsed payload keys:", Object.keys(payload));
    console.log("Full payload:", JSON.stringify(payload, null, 2));

    // ── Step 3: Extract fields ──
    const data = (payload.data || payload) as Record<string, unknown>;
    const order = (data.order || {}) as Record<string, unknown>;
    const transaction = (data.transaction || {}) as Record<string, unknown>;

    const accountNumber =
      String(data.account_number || data.accountNumber || data.virtual_account ||
             data.virtualAccountNumber || data.destinationAccount || "");

    const amount = parseFloat(
      String(order.amount || order.settlement_amount ||
             data.amount || data.amountPaid || data.amount_paid ||
             data.settlementAmount || data.settlement_amount || "0")
    );

    const reference =
      String(transaction.reference || transaction.id ||
             data.reference || data.transactionReference || data.transaction_reference ||
             data.transactionId || data.transaction_id || data.sessionId ||
             data.session_id || payload.reference || `PF_MALL_${Date.now()}`);

    const event =
      String(payload.event || payload.eventType || payload.event_type || payload.type || "unknown");

    console.log("Extracted — event:", event, "account:", accountNumber, "amount:", amount, "ref:", reference);

    if (!accountNumber || accountNumber === "undefined" || accountNumber === "null") {
      console.error("No account number in webhook payload");
      return jsonResponse({ status: "no_account_number" });
    }

    if (!amount || amount <= 0) {
      console.log("Zero or invalid amount, skipping:", amount);
      return jsonResponse({ status: "invalid_amount" });
    }

    // ── Step 4: Look up user by PocketFi account number in profiles2 ──
    const supabase = createAdminClient();

    const { data: profile, error: profileErr } = await supabase
      .from("profiles2")
      .select("id, username")
      .eq("pocketfi_account_number", accountNumber)
      .single();

    if (profileErr || !profile) {
      console.error("No user found for account:", accountNumber, profileErr?.message);
      return jsonResponse({ status: "user_not_found", accountNumber });
    }

   // ── Step 5: Insert deposit + update wallet  ──
    const amountKobo = Math.round(amount * 100);

  // 1. Insert deposit
    await supabase.from('deposits').insert({
      user_id: profile.id,
      amount_kobo: amountKobo,
      method: 'pocketfi',
      status: 'success',
      reference
    })

  // 2. Get wallet
   const { data: wallet, error: walletError } = await supabase
     .from('wallets')
    .select('*')
    .eq('user_id', profile.id)
    .single()

   if (walletError || !wallet) {
     console.error("Wallet not found:", profile.id)
     return jsonResponse({ status: "wallet_not_found" })
   }

  // 3. Update wallet balance
   await supabase
     .from('wallets')
     .update({
       balance: wallet.balance + amountKobo
     })
     .eq('user_id', profile.id)

   console.log(`✅ Wallet credited: ${amountKobo} kobo for ${profile.id}`)

   return jsonResponse({ status: "success" })
});
