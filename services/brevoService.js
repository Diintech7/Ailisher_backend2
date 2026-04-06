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

module.exports = {
  brevoEnabled,
  sendBrevoEmail,
  sendEmailOtp,
  sendPasswordResetOtp,
};
