const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { Readable } = require('stream');

// Project-bundled fonts support (assets/fonts)
const ASSET_FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const assetFont = (name) => path.join(ASSET_FONT_DIR, name);

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
    // const preferredText = buildTextFromEval(hindiEvaluation) || buildTextFromEval(evaluation) || text || '';
    const preferredText = text || '';
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
      ? String(preferredText)
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
    // Prefer bundled Latin font first, then system Arial
    const latinAssetCandidates = [ assetFont('NotoSerif-Regular.ttf') ].filter(p => fs.existsSync(p));
    const latinCandidates = (
      latinAssetCandidates.length > 0 ? latinAssetCandidates : []
    ).concat(
      process.platform === 'win32'
        ? [ 'C:/Windows/Fonts/arial.ttf' ]
        : process.platform === 'darwin'
        ? [ '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf' ]
        : [ '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' ]
    );
    const latinFont = latinCandidates.find(p => fs.existsSync(p)) || null;
    // Prefer bundled Devanagari font first, then system Nirmala/Noto
    const devAssetCandidates = [ assetFont('Poppins-Regular.ttf') ].filter(p => fs.existsSync(p));
    const devCandidates = (
      devAssetCandidates.length > 0 ? devAssetCandidates : []
    ).concat(
      process.platform === 'win32'
        ? [ 'C:/Windows/Fonts/Nirmala.ttf', 'C:/Windows/Fonts/NirmalaUI.ttf', 'C:/Windows/Fonts/NirmalaUI-Regular.ttf' ]
        : process.platform === 'darwin'
        ? [ '/Library/Fonts/NotoSansDevanagari-Regular.ttf', '/System/Library/Fonts/Supplemental/KohinoorDevanagari-Regular.otf' ]
        : [ '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf' ]
    );
    const devFont = devCandidates.find(p => fs.existsSync(p)) || null;
    // Keep font selection simple and predictable
    let selectedFont = containsDevanagari ? devFont : latinFont;
    const fallbackFontFamily = containsDevanagari ? 'Nirmala UI' : 'Arial';

    // Optional handwritten style
    if (fontStyle === 'handwritten') {
      if (containsDevanagari) {
        const devanagariHandAsset = [ assetFont('Kalam-Regular.ttf') ].filter(p => fs.existsSync(p));
        const devanagariHandCandidates = (
          devanagariHandAsset.length > 0 ? devanagariHandAsset : []
        ).concat(
          process.platform === 'win32'
            ? [ 'C:/Windows/Fonts/Kalam-Regular.ttf', 'C:/Windows/Fonts/Kalnirnay.ttf' ]
            : process.platform === 'darwin'
            ? [ '/Library/Fonts/Kalam-Regular.ttf' ]
            : [ '/usr/share/fonts/truetype/kalam/Kalam-Regular.ttf', '/usr/share/fonts/truetype/google/Kalam-Regular.ttf' ]
        );
        const devHand = devanagariHandCandidates.find(p => fs.existsSync(p)) || null;
        if (devHand) selectedFont = devHand;
      } else {
        const latinHandCandidates = process.platform === 'win32'
          ? [ 'C:/Windows/Fonts/segoesc.ttf', 'C:/Windows/Fonts/BRADHITC.TTF' ]
          : process.platform === 'darwin'
          ? [ '/Library/Fonts/Bradley Hand.ttf', '/Library/Fonts/Noteworthy.ttc' ]
          : [ '/usr/share/fonts/truetype/msttcorefonts/Comic_Sans_MS.ttf' ];
        const latHand = latinHandCandidates.find(p => fs.existsSync(p)) || null;
        if (latHand) selectedFont = latHand;
      }
    }

    // Allow custom font override (e.g., Kalam bundled with the app)
    if (customFontPath && typeof customFontPath === 'string' && fs.existsSync(customFontPath)) {
      selectedFont = customFontPath;
    }

    // Try to pick a symbol-capable font for the tick glyph ✓ (U+2713)
    const symbolAssetCandidates = [ assetFont('NotoSansSymbols2-Regular.ttf') ].filter(p => fs.existsSync(p));
    const symbolFontCandidates = (
      symbolAssetCandidates.length > 0 ? symbolAssetCandidates : []
    ).concat(
      process.platform === 'win32'
        ? [ 'C:/Windows/Fonts/seguisym.ttf' ]
        : process.platform === 'darwin'
        ? [ '/System/Library/Fonts/Supplemental/Symbol.ttf' ]
        : [ '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf' ]
    );
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

    // Optional header for relevancy and score drawn above comments (no-op if not provided)
    try {
      const srcEval = (hindiEvaluation && typeof hindiEvaluation === 'object') ? hindiEvaluation
        : ((evaluation && typeof evaluation === 'object') ? evaluation : (req.body && req.body.header) || null);
      const relVal = Number.isFinite(srcEval?.relevancy) ? Math.round(srcEval.relevancy) : null;
      const scoreVal = Number.isFinite(srcEval?.score) ? srcEval.score : null;
      if (relVal !== null || scoreVal !== null) {
        const isHindiHeader = /[\u0900-\u097F]/.test(preferredText || '') || !!hindiEvaluation;
        // const relLabel = isHindiHeader ? 'प्रासंगिकता' : 'Relevancy';
        const relLabel = 'Relevancy';
        // const scoreLabel = isHindiHeader ? 'स्कोर' : 'Score';
        const scoreLabel = 'Score';
        const parts = [];
        if (relVal !== null) parts.push(`${relLabel}: ${relVal}%`);
        if (scoreVal !== null) parts.push(`${scoreLabel}: ${scoreVal}`);
        const headerText = parts.join('  |  ');
        const headerClean = cleanTextForDrawtext(headerText);
        const headerSize = Math.max(14, Math.round((Number.isFinite(Number(fontsize)) ? Number(fontsize) : 16) * 1.05));
        let hx = '(w-text_w)/2';
        if (addSidebar) {
          hx = `w-${panelWidth}+${Math.max(12, paddingX)}`;
        } else if (requestedAlign === 'left') {
          hx = `${Math.max(12, paddingX)}`;
        } else if (requestedAlign === 'right') {
          hx = `w-text_w-${Math.max(12, paddingX)}`;
        }
        const hy = Math.max(8, startY - Math.round(lineHeight * 0.9));
        const headerLayer = selectedFont
          ? `drawtext=text='${headerClean}':fontfile='${toFilterPath(selectedFont)}':fontcolor=${fontColor}:fontsize=${headerSize}:x=${hx}:y=${hy}`
          : fallbackFontFamily
          ? `drawtext=text='${headerClean}':font='${fallbackFontFamily}':fontcolor=${fontColor}:fontsize=${headerSize}:x=${hx}:y=${hy}`
          : `drawtext=text='${headerClean}':fontcolor=${fontColor}:fontsize=${headerSize}:x=${hx}:y=${hy}`;
        layers.push(headerLayer);
      }
    } catch (_) {}
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
            : fallbackFontFamily
            ? `drawtext=text='${cleanLine}':font='${fallbackFontFamily}':fontcolor=${fontColor}:fontsize=${size}:x=${xExpr}:y=${yPos}`
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