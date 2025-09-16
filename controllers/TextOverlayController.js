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
// Request body:
// {
//   imageBase64?: string,
//   imageUrl?: string,
//   // Preferred: provide one of these blocks to auto-pick language
//   hindiEvaluation?: { comments?: string[], analysis?: { feedback?: string[], strengths?: string[], weaknesses?: string[] } },
//   evaluation?: { comments?: string[], analysis?: { feedback?: string[], strengths?: string[], weaknesses?: string[] } },
//   // Fallback: direct text to render (used as-is if provided)
//   text?: string,
//   fontsize?: number,
//   color?: string,
//   align?: 'left'|'center'|'right',
//   numbered?: boolean,
//   withTicks?: boolean,
//   tickColor?: string,
//   xPadding?: number,
//   sidebar?: boolean,
//   sidebarWidth?: number,
//   sidebarColor?: string,
//   // Font options
//   fontStyle?: 'default'|'handwritten',
//   customFontPath?: string
// }
const overlayTextOnImage = async (req, res) => {
  try {
    const { imageBase64, imageUrl, text, fontsize, color, align, numbered, withTicks, tickColor, xPadding, sidebar, sidebarWidth, sidebarColor, ticks, evaluation, hindiEvaluation, fontStyle, customFontPath } = req.body;
    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({ error: 'Provide imageBase64 or imageUrl' });
    }
    // Allow ticks-only requests; text is optional now

    // Build input buffer from base64 or fetched URL
    let inputBuffer;
    if (imageBase64) {
      inputBuffer = Buffer.from(imageBase64, 'base64');
    } else {
      const resp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      inputBuffer = Buffer.from(resp.data);
    }

    // Build text from inputs with Hindi preference if available
    const buildTextFromEval = (ev) => {
      if (!ev || typeof ev !== 'object') return '';
      const parts = [];
      if (Array.isArray(ev.comments)) parts.push(...ev.comments);
      if (ev.analysis) {
        if (Array.isArray(ev.analysis.feedback)) parts.push(...ev.analysis.feedback);
        if (Array.isArray(ev.analysis.strengths)) parts.push(...ev.analysis.strengths.map(s => `✓ ${s}`));
        if (Array.isArray(ev.analysis.weaknesses)) parts.push(...ev.analysis.weaknesses.map(w => `⚠ ${w}`));
      }
      return parts
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .join('\n\n');
    };

    // Prefer Hindi evaluation content when provided; else English; else provided text
    const preferredText = buildTextFromEval(hindiEvaluation) || buildTextFromEval(evaluation) || text || '';

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

    // Split input into comments (blank line or '|||') and wrap each comment separately
    const rawComments = preferredText && typeof preferredText === 'string'
      ? String(text)
          .split(/\n\n|\|\|\|/)
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];

    const wrappedComments = rawComments.map(c => processTextForWrapping(c, 50, 10));
    const totalWrappedLines = wrappedComments.flat();

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
    const tickFontColor = normalizeColor(tickColor); // green-500 by default
    const panelColor = normalizeColor(sidebarColor || '#FFFFFF');

    // Choose a font based on language (Latin vs Devanagari)
    const containsDevanagari = /[\u0900-\u097F]/.test(preferredText || '');
    // English/Latin font candidates
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
    // Devanagari font candidates (Windows: Nirmala UI or Mangal; macOS/Linux: Noto/Devanagari support)
    const devCandidates = process.platform === 'win32'
      ? [
          'C:/Windows/Fonts/Nirmala.ttf',
          'C:/Windows/Fonts/mangal.ttf',
          'C:/Windows/Fonts/arialuni.ttf'
        ]
      : process.platform === 'darwin'
      ? [
          '/System/Library/Fonts/Supplemental/KohinoorDevanagari-Regular.otf',
          '/Library/Fonts/NotoSansDevanagari-Regular.ttf',
          '/Library/Fonts/Arial Unicode.ttf'
        ]
      : [
          '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
          '/usr/share/fonts/truetype/indie-fonts/lohit_dev.ttf',
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        ];
    const devFont = devCandidates.find(p => fs.existsSync(p)) || null;
    // Optional handwritten font selection
    let handwritingCandidates = [];
    if (containsDevanagari) {
      // Devanagari handwritten system fonts are uncommon; fallback to Devanagari primary
      handwritingCandidates = [devFont].filter(Boolean);
    } else {
      handwritingCandidates = process.platform === 'win32'
        ? [
            'C:/Windows/Fonts/segoesc.ttf', // Segoe Script
            'C:/Windows/Fonts/BRADHITC.TTF', // Bradley Hand ITC
            'C:/Windows/Fonts/comic.ttf', // Comic Sans MS
            'C:/Windows/Fonts/Comic.ttf'
          ]
        : process.platform === 'darwin'
        ? [
            '/Library/Fonts/Bradley Hand.ttf',
            '/Library/Fonts/Noteworthy.ttc',
            '/Library/Fonts/Chalkboard.ttf',
            '/Library/Fonts/Comic Sans MS.ttf'
          ]
        : [
            '/usr/share/fonts/truetype/msttcorefonts/Comic_Sans_MS.ttf',
            '/usr/share/fonts/truetype/microsoft/Comic_Sans_MS.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf' // weak fallback
          ];
    }

    const handwritingFont = handwritingCandidates.find(p => p && fs.existsSync(p)) || null;
    let selectedFont = containsDevanagari ? (devFont || latinFont) : latinFont;

    // Allow custom font override
    if (customFontPath && typeof customFontPath === 'string' && fs.existsSync(customFontPath)) {
      selectedFont = customFontPath;
    } else if (fontStyle === 'handwritten' && handwritingFont) {
      selectedFont = handwritingFont;
    }
    // Try to pick a symbol-capable font for the tick glyph ✓ (U+2713)
    const symbolFontCandidates = process.platform === 'win32'
      ? [
          'C:/Windows/Fonts/seguisym.ttf',
          'C:/Windows/Fonts/seguiemj.ttf',
          'C:/Windows/Fonts/arial.ttf'
        ]
      : process.platform === 'darwin'
      ? [
          '/System/Library/Fonts/Supplemental/Symbol.ttf',
          '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
          '/Library/Fonts/Arial Unicode.ttf',
          '/Library/Fonts/Arial.ttf'
        ]
      : [
          '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf',
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
        ];
    const tickFont = symbolFontCandidates.find(p => fs.existsSync(p)) || latinFont;
    const size = Number.isFinite(Number(fontsize)) ? Number(fontsize) : 16;
    const lineHeight = size * 1.4; // Line height for spacing
    const startY = 50;
    const paddingX = Number.isFinite(Number(xPadding)) ? Math.max(0, Number(xPadding)) : 40;
    const requestedAlign = typeof align === 'string' ? align.toLowerCase() : 'center';
    const addSidebar = Boolean(sidebar);
    const panelWidth = Number.isFinite(Number(sidebarWidth)) ? Math.max(60, Math.floor(Number(sidebarWidth))) : 480;

    // Build layers per comment: number on first line only; one tick per comment
    let currentY = startY;
    const layers = [];
    if (totalWrappedLines.length > 0) {
      wrappedComments.forEach((lines, commentIndex) => {
        const linesForThis = Array.isArray(lines) && lines.length > 0 ? lines : [''];
        linesForThis.forEach((line, lineIndex) => {
          const isFirstLineOfComment = lineIndex === 0;
          const alreadyNumbered = /^\s*(?:\d+[\.)]|\(\d+\))\s+/.test(line);
          const displayText = numbered && isFirstLineOfComment && !alreadyNumbered
            ? `${commentIndex + 1}. ${line}`
            : line;
          const cleanLine = cleanTextForDrawtext(displayText);
          const yPos = currentY;

          // Compute x based on alignment or sidebar
          let xExpr = '(w-text_w)/2';
          if (addSidebar) {
            // Sidebar is a right panel of width panelWidth; start text inside it
            xExpr = `w-${panelWidth}+${paddingX}`;
          } else if (requestedAlign === 'left') {
            xExpr = `${paddingX}`;
          } else if (requestedAlign === 'right') {
            xExpr = `w-text_w-${paddingX}`;
          }

          const textLayer = selectedFont
            ? `drawtext=text='${cleanLine}':fontfile='${toFilterPath(selectedFont)}':fontcolor=${fontColor}:fontsize=${size}:x=${xExpr}:y=${yPos}`
            : `drawtext=text='${cleanLine}':fontcolor=${fontColor}:fontsize=${size}:x=${xExpr}:y=${yPos}`;
          layers.push(textLayer);

          // One tick per comment at its first line (auto position)
          if (!addSidebar && withTicks && isFirstLineOfComment) {
            const tickChar = cleanTextForDrawtext('✓');
            let tickXExpr;
            if (requestedAlign === 'right') {
              tickXExpr = `w-${Math.max(8, paddingX)}`;
            } else if (requestedAlign === 'left') {
              tickXExpr = `${Math.max(8, paddingX - Math.round(size / 2))}`;
            } else {
              tickXExpr = `w-${Math.max(8, paddingX)}`; // default near right edge
            }
            const tickLayer = tickFont
              ? `drawtext=text='${tickChar}':fontfile='${toFilterPath(tickFont)}':fontcolor=${tickFontColor}:fontsize=${Math.round(size / 3)}:x=${tickXExpr}:y=${yPos}`
              : `drawtext=text='${tickChar}':fontcolor=${tickFontColor}:fontsize=${Math.round(size / 3)}:x=${tickXExpr}:y=${yPos}`;
            layers.push(tickLayer);
          }

          currentY += lineHeight;
        });
        // Extra spacing between comments
        currentY += Math.round(lineHeight * 0.5);
      });
    }

    // Optional right white sidebar using pad filter
    const prefixFilters = addSidebar ? [`pad=iw+${panelWidth}:ih:0:0:${panelColor}`] : [];
    // Optional explicit tick marks overlay (custom positions)
    // ticks: [{ x: number (px or 0-1 fraction), y: number (px or 0-1 fraction), size: number (px), color: string }]
    const tickLayers = [];
    if (Array.isArray(ticks)) {
      const toExpr = (val, axis) => {
        if (typeof val === 'number') {
          if (val >= 0 && val <= 1) {
            return axis === 'x' ? `(w*${val})` : `(h*${val})`;
          }
          return `${Math.round(val)}`;
        }
        // fallback center
        return axis === 'x' ? '(w-text_w)/2' : '(h-text_h)/2';
      };
      ticks.forEach((t) => {
        const tSize = Number.isFinite(Number(t?.size)) ? Math.max(8, Math.round(Number(t.size))) : 35;
        const tColor = normalizeColor(t?.color || tickColor || '#16A34A'); // default green
        const tx = toExpr(t?.x, 'x');
        const ty = toExpr(t?.y, 'y');
        const tickChar = cleanTextForDrawtext('✓');
        const layer = tickFont
          ? `drawtext=text='${tickChar}':fontfile='${toFilterPath(tickFont)}':fontcolor=${tColor}:fontsize=${tSize}:x=${tx}:y=${ty}`
          : `drawtext=text='${tickChar}':fontcolor=${tColor}:fontsize=${tSize}:x=${tx}:y=${ty}`;
        tickLayers.push(layer);
      });
    }

    const drawtextFilters = [...prefixFilters, ...layers, ...tickLayers];

    if (drawtextFilters.length === 0) {
      return res.status(400).json({ error: 'Nothing to draw: provide text or ticks' });
    }

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