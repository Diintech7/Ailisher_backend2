const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const axios = require('axios');
const { Readable } = require('stream');

// Set FFmpeg paths (reuse setup pattern from video controller)
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Utilities borrowed/adapted from generatevideocontroller
const cleanTextForDrawtext = (text) => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/["']/g, '')
    .replace(/:/g, ' ')
    .replace(/;/g, ',')
    .replace(/\\/g, '/')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/%/g, 'percent')
    .replace(/=/g, ' equals ')
    .replace(/\s+/g, ' ')
    .trim();
};

// NOTE: Hindi detection and handling removed; English-only overlay

// Removed Hindi font path resolution; English-only overlay

// Normalize file path for FFmpeg filter (escape drive colon and use forward slashes)
const toFilterPath = (absolutePath) => {
  const withForward = absolutePath.replace(/\\/g, '/');
  return withForward.replace(/^([A-Za-z]):/, '$1\\:');
};

// Removed Hindi-specific filter; English-only overlay will set fontfile/textfile directly

// Controller: overlay text on a single image (base64 or URL) using in-memory streams (no temp files)
// Request body: { imageBase64?: string, imageUrl?: string, text: string, fontsize?: number, color?: string, bgColor?: string, bgOpacity?: number }
const overlayTextOnImage = async (req, res) => {
  try {
    const { imageBase64, imageUrl, text, fontsize, color, bgColor, bgOpacity } = req.body;
    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({ error: 'Provide imageBase64 or imageUrl' });
    }
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Provide overlay text' });
    }

    // Build input buffer from base64 or fetched URL
    let inputBuffer;
    if (imageBase64) {
      inputBuffer = Buffer.from(imageBase64, 'base64');
    } else {
      const resp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      inputBuffer = Buffer.from(resp.data);
    }

    const clean = cleanTextForDrawtext(text);
    if (!clean.trim()) {
      return res.status(400).json({ error: 'Text is empty after cleaning' });
    }

    let drawtextFilter;

    // Normalize color: accept CSS hex like #RRGGBB or simple names; default to white
    const normalizeColor = (c) => {
      if (!c || typeof c !== 'string') return 'white';
      const trimmed = c.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
        const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
        return `0x${hex.toUpperCase()}`;
      }
      // basic names fallback
      return trimmed.toLowerCase();
    };
    const fontColor = normalizeColor(color);
    const boxBaseColor = normalizeColor(bgColor || '#000000');
    let boxAlpha = 0.8;
    if (typeof bgOpacity === 'number' && bgOpacity >= 0 && bgOpacity <= 1) {
      boxAlpha = bgOpacity;
    }

    // English-only: choose a Latin font
    const latinCandidates = process.platform === 'win32'
      ? [
          'C:/Windows/Fonts/arial.ttf',
          'C:/Windows/Fonts/segoeui.ttf',
          'C:/Windows/Fonts/calibri.ttf'
        ]
      : process.platform === 'darwin'
      ? [
          '/Library/Fonts/Arial.ttf',
          '/System/Library/Fonts/Supplemental/Arial.ttf'
        ]
      : [
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
        ];

    let latinFont = latinCandidates.find(p => fs.existsSync(p)) || null;
    const size = Number.isFinite(Number(fontsize)) ? Number(fontsize) : 48;
    // Fixed position centered top with same padding as previous bottom (120px)
    const posX = '(w-text_w)/2';
    const posY = '120';
    const boxSegment = boxAlpha > 0 ? `:box=1:boxcolor=${boxBaseColor}@${boxAlpha}:boxborderw=12` : '';
    const safeText = clean; // already sanitized
    if (latinFont) {
      const fontfile = toFilterPath(latinFont);
      drawtextFilter = `drawtext=text='${safeText}':fontfile='${fontfile}':fontcolor=${fontColor}:fontsize=${size}${boxSegment}:x=${posX}:y=${posY}`;
    } else {
      drawtextFilter = `drawtext=text='${safeText}':fontcolor=${fontColor}:fontsize=${size}${boxSegment}:x=${posX}:y=${posY}`;
    }

    const inputStream = Readable.from(inputBuffer);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(inputStream)
        .inputOptions(['-f', 'image2pipe'])
        .outputOptions([
          '-vf', drawtextFilter,
          '-frames:v', '1',
          '-vcodec', 'png'
        ])
        .format('image2pipe')
        .on('start', (cmd) => { console.log('FFmpeg image overlay command:', cmd); })
        .on('error', (err) => { reject(err); })
        .on('end', () => { resolve(); });

      const ffstream = command.pipe();
      ffstream.on('data', (c) => chunks.push(c));
      ffstream.on('error', (err) => { reject(err); });
    });

    const outBuffer = Buffer.concat(chunks);
    const base64 = outBuffer.toString('base64');

    return res.json({ success: true, image: base64 });
  } catch (error) {
    console.error('Image text overlay error:', error);
    return res.status(500).json({ error: 'Failed to overlay text on image', details: error.message });
  }
};

module.exports = {
  overlayTextOnImage
};


