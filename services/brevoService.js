const axios = require("axios");

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

function brevoEnabled() {
  return String(process.env.USE_BREVO || "").toLowerCase() === "true";
}

function getBrevoHeaders() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;
  return {
    "api-key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Send a transactional email via Brevo HTTP API.
 */
async function sendBrevoEmail({ to, subject, htmlContent, textContent }) {
  if (!brevoEnabled()) {
    return { sent: false, reason: "brevo_disabled" };
  }
  const headers = getBrevoHeaders();
  if (!headers) {
    console.warn("[brevoService] BREVO_API_KEY missing.");
    return { sent: false, reason: "missing_api_key" };
  }

  const senderEmail =
    process.env.BREVO_FROM_EMAIL || process.env.MAIL_FROM || "noreply@example.com";
  const senderName = process.env.BREVO_FROM_NAME || "App";

  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: htmlContent || undefined,
    textContent: textContent || undefined,
  };

  await axios.post(BREVO_API, body, { headers, timeout: 20000 });
  return { sent: true };
}

async function sendEmailOtp({ to, otp, clientName }) {
  const subject = `${otp} is your verification code${clientName ? ` — ${clientName}` : ""}`;
  const textContent = `Your verification code is: ${otp}\n\nIt expires in 10 minutes. Do not share this code.`;
  const htmlContent = `<p>Your verification code is:</p><p style="font-size:24px;font-weight:bold;">${otp}</p><p>It expires in 10 minutes. Do not share this code.</p>`;
  return sendBrevoEmail({ to, subject, htmlContent, textContent });
}

async function sendPasswordResetOtp({ to, otp, clientName }) {
  const subject = `${otp} is your password reset code${clientName ? ` — ${clientName}` : ""}`;
  const textContent = `Your password reset code is: ${otp}\n\nIt expires in 10 minutes. Do not share this code.`;
  const htmlContent = `<p>Your password reset code is:</p><p style="font-size:24px;font-weight:bold;">${otp}</p><p>It expires in 10 minutes. Do not share this code.</p>`;
  return sendBrevoEmail({ to, subject, htmlContent, textContent });
}

async function sendPurchaseReceiptEmail({
  to,
  customerName,
  customerPhone,
  clientName,
  orderId,
  createdAt,
  paymentMode,
  amount,
  itemName,
}) {
  const dateStr = new Date(createdAt || Date.now()).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const totalVal = Number(amount || 0);
  const subtotalVal = totalVal / 1.18;
  const gstVal = totalVal - subtotalVal;

  const subject = `Invoice for your purchase at ${clientName || "mAIns"}`;
  
  const textContent = `
    Thank you for purchasing!
    Invoice ID: INV-${orderId}
    Date: ${dateStr}
    Client: ${clientName}
    Billed To: ${customerName} (Phone: ${customerPhone || "N/A"})
    Item: ${itemName}
    Subtotal: INR ${subtotalVal.toFixed(2)}
    GST (18%): INR ${gstVal.toFixed(2)}
    Total Paid: INR ${totalVal.toFixed(2)}
    Payment Mode: ${paymentMode || "UPI"}
  `;

  const htmlContent = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b; background-color: #ffffff;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 15px; margin-bottom: 20px;">
        <div>
          <h1 style="font-size: 28px; font-weight: 900; color: #4f46e5; margin: 0;">${clientName || "mAIns"}</h1>
          <p style="font-size: 11px; color: #64748b; margin: 2px 0 0 0;">Digital Learning Platform Invoice</p>
        </div>
        <div style="text-align: right;">
          <h2 style="font-size: 18px; font-weight: bold; color: #0f172a; margin: 0;">INVOICE</h2>
          <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Invoice ID: <span style="font-weight: 600; color: #1e293b;">INV-${orderId}</span></p>
          <p style="font-size: 11px; color: #64748b; margin: 2px 0 0 0;">Date: ${dateStr.toLowerCase()}</p>
        </div>
      </div>

      <!-- Information Grid -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 25px;">
        <div style="width: 48%;">
          <h3 style="font-size: 11px; font-weight: bold; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 6px 0;">Billed To</h3>
          <p style="font-size: 14px; font-weight: bold; color: #0f172a; margin: 0;">${customerName || "Student"}</p>
          <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Phone: ${customerPhone || "N/A"}</p>
          <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">Email: ${to}</p>
        </div>
        <div style="width: 48%; text-align: right;">
          <h3 style="font-size: 11px; font-weight: bold; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 6px 0;">Payment Details</h3>
          <p style="font-size: 13px; color: #1e293b; margin: 0;"><span style="font-weight: 600;">Gateway:</span> Paytm</p>
          <p style="font-size: 13px; color: #1e293b; margin: 3px 0 0 0;"><span style="font-weight: 600;">Payment Mode:</span> ${paymentMode || "UPI"}</p>
          <p style="font-size: 13px; color: #15803d; font-weight: bold; margin: 3px 0 0 0;">Status: SUCCESS (PAID)</p>
        </div>
      </div>

      <!-- Invoice Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase;">Item Description</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; width: 60px;">Qty</th>
            <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; width: 100px;">Unit Price</th>
            <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; width: 100px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 14px 12px; font-size: 13px; font-weight: bold; color: #0f172a;">${itemName}</td>
            <td style="padding: 14px 12px; font-size: 13px; text-align: center; color: #475569;">1</td>
            <td style="padding: 14px 12px; font-size: 13px; text-align: right; color: #475569;">&#8377;${subtotalVal.toFixed(2)}</td>
            <td style="padding: 14px 12px; font-size: 13px; text-align: right; font-weight: bold; color: #0f172a;">&#8377;${subtotalVal.toFixed(2)}</td>
          </tr>
          <!-- Calculations -->
          <tr>
            <td colspan="2" style="padding: 0;"></td>
            <td style="padding: 8px 12px; font-size: 12px; font-weight: bold; text-align: right; color: #64748b;">Subtotal:</td>
            <td style="padding: 8px 12px; font-size: 12px; font-weight: 600; text-align: right; color: #334155;">&#8377;${subtotalVal.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 0;"></td>
            <td style="padding: 8px 12px; font-size: 12px; font-weight: bold; text-align: right; color: #64748b;">GST (18%):</td>
            <td style="padding: 8px 12px; font-size: 12px; font-weight: 600; text-align: right; color: #334155;">&#8377;${gstVal.toFixed(2)}</td>
          </tr>
          <tr style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
            <td colspan="2" style="padding: 0;"></td>
            <td style="padding: 10px 12px; font-size: 13px; font-weight: bold; text-align: right; color: #0f172a;">Total Paid:</td>
            <td style="padding: 10px 12px; font-size: 13px; font-weight: 900; text-align: right; color: #4f46e5;">&#8377;${totalVal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Footer -->
      <div style="text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #cbd5e1; padding-top: 15px; margin-top: 25px;">
        <p style="margin: 0; font-weight: 500;">Thank you for purchasing with us!</p>
        <p style="margin: 4px 0 0 0; font-size: 10px;">If you have any questions or queries regarding this purchase, please contact support.</p>
      </div>
    </div>
  `;

  return sendBrevoEmail({
    to,
    subject,
    htmlContent,
    textContent,
  });
}

module.exports = {
  brevoEnabled,
  sendBrevoEmail,
  sendEmailOtp,
  sendPasswordResetOtp,
  sendPurchaseReceiptEmail,
};

