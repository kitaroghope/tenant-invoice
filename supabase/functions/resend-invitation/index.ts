import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:5173";
const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "587");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SMTP_FROM = Deno.env.get("SMTP_FROM") ?? SMTP_USER;

const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// Rotates a pending invitation's token (via the already-permission-checked resend_invitation
// RPC, called as the real caller) and re-sends the invitation email with the new link.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  let payload: { membershipId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const membershipId = payload.membershipId?.trim();
  if (!membershipId) return jsonResponse({ error: "membershipId is required" }, 400);

  // See invite-member/index.ts for why this is built on the ANON key, not the service-role key.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: newToken, error: resendError } = await callerClient.rpc("resend_invitation", {
    p_membership_id: membershipId,
  });
  if (resendError) return jsonResponse({ error: resendError.message }, 400);

  const { data: membership, error: membershipError } = await callerClient
    .from("business_memberships")
    .select("user_id, businesses(legal_name, trading_name)")
    .eq("id", membershipId)
    .single();
  if (membershipError || !membership) {
    return jsonResponse({ error: membershipError?.message ?? "Membership not found" }, 400);
  }

  const business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;
  const businessName = business?.trading_name || business?.legal_name || "your business";

  const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(membership.user_id as string);
  if (userError || !userData?.user?.email) {
    return jsonResponse({ success: true, warning: "Token rotated but the recipient's email could not be resolved" });
  }

  const acceptUrl = `${SITE_URL}/accept-invitation?token=${encodeURIComponent(newToken as string)}`;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to: userData.user.email,
        subject: `Reminder: you've been invited to join ${businessName}`,
        html: `
          <p>Here's a fresh invitation link to join <strong>${businessName}</strong>.</p>
          <p><a href="${acceptUrl}">Accept invitation</a></p>
          <p>This invitation expires in 7 days. Didn't expect this? You can ignore this email.</p>
        `,
      });
    } catch (mailError) {
      console.error("Failed to resend invitation email", mailError);
      return jsonResponse({ success: true, warning: "Token rotated but the email failed to send" });
    }
  } else {
    console.warn("SMTP secrets are not configured; resend email was not sent.");
  }

  return jsonResponse({ success: true });
});
