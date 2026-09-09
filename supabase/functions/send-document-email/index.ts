import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

function formatMoney(minorUnits: number, exponent: number, currencyCode: string): string {
  const value = minorUnits / 10 ** exponent;
  return `${value.toFixed(exponent)} ${currencyCode}`;
}

// Emails an invoice or receipt to a customer. No PDF renderer exists yet, so the email
// carries a plain-text/HTML summary rather than an attachment — deliberately the simplest
// thing that gives a customer what they need (what they owe or what they paid), matching
// the rest of this app's "as simple as possible" bias.
//
// Unlike invite-member/resend-invitation, this never touches the GoTrue admin API, so it
// only needs the ANON key + the caller's own JWT — never the service-role key. The RPC
// calls below (queue_email_message, mark_email_message_sent) enforce permission and
// entitlement checks as the real caller, exactly like every other mutation in this app.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  let payload: { businessId?: string; resourceType?: string; resourceId?: string; recipientEmail?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const businessId = payload.businessId?.trim();
  const resourceType = payload.resourceType?.trim();
  const resourceId = payload.resourceId?.trim();
  const recipientEmailOverride = payload.recipientEmail?.trim();

  if (!businessId || !resourceType || !resourceId) {
    return jsonResponse({ error: "businessId, resourceType, and resourceId are required" }, 400);
  }
  if (resourceType !== "invoice" && resourceType !== "receipt") {
    return jsonResponse({ error: "resourceType must be 'invoice' or 'receipt'" }, 400);
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: businessRow, error: businessError } = await callerClient
    .from("businesses")
    .select("legal_name, trading_name")
    .eq("id", businessId)
    .single();
  if (businessError || !businessRow) {
    return jsonResponse({ error: "Business not found or you do not have access to it" }, 403);
  }
  const businessName = businessRow.trading_name || businessRow.legal_name;

  let recipientEmail = recipientEmailOverride ?? null;
  let subject: string;
  let html: string;

  if (resourceType === "invoice") {
    const { data: invoice, error: invoiceError } = await callerClient
      .from("invoices")
      .select("invoice_number, status, customer_display_name, customer_email, total_minor_units, currency_code, currency_exponent, due_at")
      .eq("id", resourceId)
      .eq("business_id", businessId)
      .single();
    if (invoiceError || !invoice) return jsonResponse({ error: "Invoice not found" }, 404);

    recipientEmail = recipientEmail || invoice.customer_email;
    if (!recipientEmail) return jsonResponse({ error: "No recipient email on file for this invoice" }, 400);

    const amount = formatMoney(invoice.total_minor_units, invoice.currency_exponent, invoice.currency_code);
    const dueLine = invoice.due_at ? `<p>Due: ${new Date(invoice.due_at).toLocaleDateString()}</p>` : "";
    subject = invoice.invoice_number ? `Invoice #${invoice.invoice_number} from ${businessName}` : `Invoice from ${businessName}`;
    html = `
      <p>Dear ${invoice.customer_display_name},</p>
      <p>${businessName} has sent you ${invoice.invoice_number ? `invoice #${invoice.invoice_number}` : "an invoice"} for <strong>${amount}</strong>.</p>
      ${dueLine}
      <p>Status: ${invoice.status}</p>
      <p>Please contact ${businessName} directly if you have any questions about this invoice.</p>
    `;
  } else {
    const { data: receipt, error: receiptError } = await callerClient
      .from("receipts")
      .select("receipt_number, issued_at, payments(customer_display_name, customer_email, amount_minor_units, currency_code, currency_exponent, payment_method)")
      .eq("id", resourceId)
      .eq("business_id", businessId)
      .single();
    if (receiptError || !receipt) return jsonResponse({ error: "Receipt not found" }, 404);

    const payment = Array.isArray(receipt.payments) ? receipt.payments[0] : receipt.payments;
    if (!payment) return jsonResponse({ error: "This receipt has no associated payment" }, 400);

    recipientEmail = recipientEmail || payment.customer_email;
    if (!recipientEmail) return jsonResponse({ error: "No recipient email on file for this receipt" }, 400);

    const amount = formatMoney(payment.amount_minor_units, payment.currency_exponent, payment.currency_code);
    subject = receipt.receipt_number ? `Receipt #${receipt.receipt_number} from ${businessName}` : `Receipt from ${businessName}`;
    html = `
      <p>Dear ${payment.customer_display_name},</p>
      <p>${businessName} confirms receipt of <strong>${amount}</strong> via ${String(payment.payment_method).replace("_", " ")}.</p>
      <p>Issued: ${new Date(receipt.issued_at).toLocaleString()}</p>
      <p>Thank you for your business.</p>
    `;
  }

  const { data: messageId, error: queueError } = await callerClient.rpc("queue_email_message", {
    p_business_id: businessId,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_recipient_email: recipientEmail,
    p_subject: subject,
  });
  if (queueError) return jsonResponse({ error: queueError.message }, 400);

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    await callerClient.rpc("mark_email_message_sent", {
      p_message_id: messageId,
      p_success: false,
      p_provider_message_id: null,
      p_error_message: "SMTP is not configured on the server",
    });
    return jsonResponse({ error: "Email delivery is not configured for this project" }, 500);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    const info = await transporter.sendMail({ from: SMTP_FROM, to: recipientEmail, subject, html });
    await callerClient.rpc("mark_email_message_sent", {
      p_message_id: messageId,
      p_success: true,
      p_provider_message_id: info.messageId ?? null,
      p_error_message: null,
    });
    return jsonResponse({ success: true, messageId });
  } catch (mailError) {
    const errorMessage = mailError instanceof Error ? mailError.message : "Unknown SMTP error";
    await callerClient.rpc("mark_email_message_sent", {
      p_message_id: messageId,
      p_success: false,
      p_provider_message_id: null,
      p_error_message: errorMessage,
    });
    return jsonResponse({ error: `Email failed to send: ${errorMessage}` }, 502);
  }
});
