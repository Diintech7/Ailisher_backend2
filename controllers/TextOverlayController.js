const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const https = require('https');
const http = require('http');

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

const downloadFile = (url, filepath) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(filepath);
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
};

// Removed Hindi font path resolution; English-only overlay

// Normalize file path for FFmpeg filter (escape drive colon and use forward slashes)
const toFilterPath = (absolutePath) => {
  const withForward = absolutePath.replace(/\\/g, '/');
  return withForward.replace(/^([A-Za-z]):/, '$1\\:');
};

// Removed Hindi-specific filter; English-only overlay will set fontfile/textfile directly

// Controller: overlay text on a single image (base64 or URL)
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

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const inputPath = path.join(tempDir, `input_${Date.now()}.png`);
    const outputPath = path.join(tempDir, `output_${Date.now()}.png`);

    if (imageBase64) {
      const buffer = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(inputPath, buffer);
    } else if (imageUrl) {
      await downloadFile(imageUrl, inputPath);
    }

    const clean = cleanTextForDrawtext(text);
    if (!clean.trim()) {
      return res.status(400).json({ error: 'Text is empty after cleaning' });
    }

    // Write text to a temporary UTF-8 file to avoid quoting issues
    const textfilePath = path.join(tempDir, `overlay_text_${Date.now()}.txt`);
    fs.writeFileSync(textfilePath, clean, { encoding: 'utf8' });

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
    const posX = '(w-text_w)/2';
    const posY = '120';
    const textfile = toFilterPath(textfilePath);

    // Build optional box options only when opacity > 0
    const boxOptions = boxAlpha > 0
      ? `:box=1:boxcolor=${boxBaseColor}@${boxAlpha}:boxborderw=12`
      : '';

    // Build drawtext filter
    const baseDrawtext = latinFont
      ? `drawtext=textfile='${textfile}':fontfile='${toFilterPath(latinFont)}':fontcolor=${fontColor}:fontsize=${size}${boxOptions}:x=${posX}:y=${posY}`
      : `drawtext=textfile='${textfile}':fontcolor=${fontColor}:fontsize=${size}${boxOptions}:x=${posX}:y=${posY}`;

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputPath)
        .outputOptions([
          '-vf', baseDrawtext,
          '-frames:v', '1',
          '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => { console.log('FFmpeg image overlay command:', cmd); })
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const outBuffer = fs.readFileSync(outputPath);
    const base64 = outBuffer.toString('base64');

    // cleanup temp files (best-effort)
    [inputPath, textfilePath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });

    return res.json({ success: true, image: base64, outputPath });
  } catch (error) {
    console.error('Image text overlay error:', error);
    return res.status(500).json({ error: 'Failed to overlay text on image', details: error.message });
  }
};

module.exports = {
  overlayTextOnImage
};