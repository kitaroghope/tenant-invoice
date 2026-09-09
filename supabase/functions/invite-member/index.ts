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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Invites a person into a business by email + role.
// Privileged work (resolving/creating the invitee's auth account, sending mail) runs here
// with the service role key, which never reaches the browser. The actual membership write
// goes through create_invitation using the CALLER's own JWT, so Postgres still enforces the
// members.manage permission check as the real inviter, not as this function.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  let payload: { businessId?: string; email?: string; roleId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const businessId = payload.businessId?.trim();
  const email = payload.email?.trim().toLowerCase();
  const roleId = payload.roleId?.trim();

  if (!businessId || !email || !roleId) {
    return jsonResponse({ error: "businessId, email, and roleId are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  // Built on the ANON key with the caller's own JWT forwarded, so Postgres sees the real
  // inviter (auth.uid()) and enforces members.manage as them — not as a privileged service.
  // The service-role key is used ONLY by adminClient below, for the one thing that
  // genuinely needs it (the GoTrue admin API). Never build the caller-scoped client on the
  // service-role key: if the Authorization override were ever dropped, it would silently
  // fall back to full service-role authority instead of failing closed.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Read the business name from the database rather than trusting a client-supplied value —
  // this is what appears in the invitation email, and a caller with members.manage on their
  // own business shouldn't be able to put arbitrary text there.
  const { data: businessRow, error: businessError } = await callerClient
    .from("businesses")
    .select("legal_name, trading_name")
    .eq("id", businessId)
    .single();
  if (businessError || !businessRow) {
    return jsonResponse({ error: "Business not found or you do not have access to it" }, 403);
  }
  const businessName = businessRow.trading_name || businessRow.legal_name;

  // generateLink resolves the invitee's user id, creating the auth account if it doesn't
  // exist yet, WITHOUT sending any Supabase-authored email itself — we send our own below
  // so new and existing invitees get one consistent, business-branded message.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData?.user) {
    return jsonResponse({ error: linkError?.message ?? "Could not resolve that email address" }, 400);
  }

  const invitedUserId = linkData.user.id;
  const isNewAccount = !linkData.user.last_sign_in_at && !linkData.user.email_confirmed_at;

  const { data: inviteRows, error: inviteError } = await callerClient.rpc("create_invitation", {
    p_business_id: businessId,
    p_user_id: invitedUserId,
    p_role_id: roleId,
  });

  if (inviteError) {
    return jsonResponse({ error: inviteError.message }, 400);
  }

  const row = Array.isArray(inviteRows) ? inviteRows[0] : inviteRows;
  const token = row?.token as string | undefined;
  if (!token) {
    return jsonResponse({ error: "Invitation was created but no token was returned" }, 500);
  }

  const acceptUrl = `${SITE_URL}/accept-invitation?token=${encodeURIComponent(token)}`;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const setupLine = isNewAccount && linkData.properties?.action_link
      ? `<p>New here? <a href="${linkData.properties.action_link}">Set up your account</a> first, then use the button above.</p>`
      : "";

    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: `You've been invited to join ${businessName}`,
        html: `
          <p>You've been invited to join <strong>${businessName}</strong>.</p>
          <p><a href="${acceptUrl}">Accept invitation</a></p>
          ${setupLine}
          <p>This invitation expires in 7 days. Didn't expect this? You can ignore this email.</p>
        `,
      });
    } catch (mailError) {
      console.error("Failed to send invitation email", mailError);
      return jsonResponse({ success: true, membershipId: row?.membership_id, warning: "Invitation created but the email failed to send" }, 200);
    }
  } else {
    console.warn("SMTP secrets are not configured; invitation email was not sent.", { email });
  }

  return jsonResponse({ success: true, membershipId: row?.membership_id });
});
