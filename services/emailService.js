const nodemailer = require("nodemailer");

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function getFrom() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@localhost";
}

async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      "[emailService] SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Email not sent."
    );
    return { sent: false, reason: "smtp_not_configured" };
  }
  await transporter.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
    html: html || text,
  });
  return { sent: true };
}

async function sendWelcomeEmail({ to, clientName, clientId }) {
  const subject = `Welcome to ${clientName || "our app"}`;
  const text = `Your account was registered for client ${clientId}.\nYou can now sign in with Google using this email.`;
  return sendMail({ to, subject, text });
}

async function sendPasswordResetEmail({ to, resetUrl, clientName }) {
  const subject = `Reset your password — ${clientName || "App"}`;
  const text = `Reset your password by opening this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`;
  const html = `<p>Reset your password by clicking <a href="${resetUrl}">here</a>.</p><p>Link expires in 1 hour.</p>`;
  return sendMail({ to, subject, text, html });
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
};
