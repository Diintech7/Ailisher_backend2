const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const https = require('https');
const http = require('http');
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

// Normalize file path for FFmpeg filter (escape drive colon and use forward slashes)
const toFilterPath = (absolutePath) => {
  const withForward = absolutePath.replace(/\\/g, '/');
  return withForward.replace(/^([A-Za-z]):/, '$1\\:');
};

// Controller: overlay text on a single image (base64 or URL) using in-memory streams
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

    // Process text to create properly wrapped lines
    const processTextForWrapping = (text, maxCharsPerLine = 50, maxLines = 10) => {
      if (!text || typeof text !== 'string') return [];
      
      const lines = text.split('\n');
      const wrappedLines = [];
      
      for (const line of lines) {
        if (wrappedLines.length >= maxLines) break;
        
        const cleanLine = line.trim();
        if (!cleanLine) continue;
        
        // If line is already short enough, use it as is
        if (cleanLine.length <= maxCharsPerLine) {
          wrappedLines.push(cleanLine);
          continue;
        }
        
        // Split long line into words and wrap
        const words = cleanLine.split(/\s+/);
        let currentLine = '';
        
        for (const word of words) {
          if (wrappedLines.length >= maxLines) break;
          
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          
          if (testLine.length > maxCharsPerLine) {
            if (currentLine) {
              wrappedLines.push(currentLine);
              currentLine = word;
            } else {
              // Single word too long, truncate it
              wrappedLines.push(word.substring(0, maxCharsPerLine - 3) + '...');
              currentLine = '';
            }
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine && wrappedLines.length < maxLines) {
          wrappedLines.push(currentLine);
        }
      }
      
      return wrappedLines.length > 0 ? wrappedLines : ['No text available'];
    };

    const textLines = processTextForWrapping(text, 50, 10);
    if (textLines.length === 0) {
      return res.status(400).json({ error: 'Text is empty after processing' });
    }

    // Normalize color: accept CSS hex like #RRGGBB or simple names; default to white
    const normalizeColor = (c) => {
      if (!c || typeof c !== 'string') return 'white';
      const trimmed = c.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
        const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
        return `0x${hex.toUpperCase()}`;
      }
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

    const latinFont = latinCandidates.find(p => fs.existsSync(p)) || null;
    const size = Number.isFinite(Number(fontsize)) ? Number(fontsize) : 16;
    const lineHeight = size * 1.4; // Line height for spacing
    const startY = 50;

    // Create multiple drawtext filters for each line
    const drawtextFilters = textLines.map((line, index) => {
      const cleanLine = cleanTextForDrawtext(line);
      const yPos = startY + (index * lineHeight);
      const boxOptions = boxAlpha > 0
        ? `:box=1:boxcolor=${boxBaseColor}@${boxAlpha}:boxborderw=8`
        : '';
      
      return latinFont
        ? `drawtext=text='${cleanLine}':fontfile='${toFilterPath(latinFont)}':fontcolor=${fontColor}:fontsize=${size}${boxOptions}:x=(w-text_w)/2:y=${yPos}`
        : `drawtext=text='${cleanLine}':fontcolor=${fontColor}:fontsize=${size}${boxOptions}:x=(w-text_w)/2:y=${yPos}`;
    });

    // Combine all drawtext filters
    const combinedFilter = drawtextFilters.join(',');

    // Process entirely in-memory using streams
    const inputStream = Readable.from(inputBuffer);
    const chunks = [];

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(inputStream)
        .inputOptions(['-f', 'image2pipe'])
        .outputOptions([
          '-vf', combinedFilter,
          '-frames:v', '1',
          '-vcodec', 'png'
        ])
        .format('image2pipe')
        .on('start', (cmd) => { console.log('FFmpeg image overlay command:', cmd); })
        .on('error', (err) => {
          reject(err);
        })
        .on('end', () => {
          resolve();
        });

      const ffstream = command.pipe();
      ffstream.on('data', (c) => chunks.push(c));
      ffstream.on('error', (err) => {
        reject(err);
      });
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