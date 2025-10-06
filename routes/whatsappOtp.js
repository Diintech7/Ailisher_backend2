const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const OTP = require('../models/OTP');

const router = express.Router();

// Helpers
function generateSixDigitOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

async function sendWhatsAppTemplateOtp({ to, otp }) {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v20.0';

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    throw new Error('WhatsApp API credentials are not configured');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const data = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'otp_verification',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: otp,
            },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            {
              type: 'text',
              text: otp,
            },
          ],
        },
      ],
    },
  };

  const response = await axios.post(url, data, { headers });
  return response.data;
}

// POST /api/whatsapp/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile, client = 'ailisher' } = req.body;

    if (!mobile) {
      return res.status(400).json({ success: false, message: 'mobile is required' });
    }

    // Normalize to E.164 if needed; assuming caller provides full WhatsApp number with country code
    const to = mobile;
    const otp = generateSixDigitOtp();

    // Save OTP with TTL using model's expiresAt default
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await OTP.create({ mobile, otp, client, expiresAt, isUsed: false });

    // Send over WhatsApp
    await sendWhatsAppTemplateOtp({ to, otp });

    return res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    const errMsg = error.response?.data || error.message || 'Failed to send OTP';
    return res.status(500).json({ success: false, message: 'OTP sending failed', error: errMsg });
  }
});

// POST /api/whatsapp/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, otp, client = 'ailisher' } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'mobile and otp are required' });
    }

    const record = await OTP.findOne({ mobile, otp, client, isUsed: false });
    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    record.isUsed = true;
    await record.save();

    return res.status(200).json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'OTP verification failed' });
  }
});

module.exports = router;


