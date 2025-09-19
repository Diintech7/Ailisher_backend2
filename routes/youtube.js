const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { createClient } = require('@deepgram/sdk');
const { error } = require('console');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Absolute yt-dlp path for Linux (EC2) and default exe for Windows
const YTDLP_PATH = process.platform === 'win32' ? 'yt-dlp.exe' : '/usr/bin/yt-dlp';

// Replace with your actual Deepgram API key
const deepgram = createClient(process.env.DEEPGRAM_API_KEY || 'YOUR_DEEPGRAM_API_KEY');

// POST /api/youtube/transcribe-audio
router.post('/transcribe-audio', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    try {
        const ytdlp = spawn(YTDLP_PATH, [
            '-x', '--audio-format', 'mp3', '-o', '-', url
        ]);

        let audioChunks = [];
        ytdlp.stdout.on('data', (chunk) => {
            audioChunks.push(chunk);
        });

        ytdlp.stderr.on('data', (data) => {
            console.error(`yt-dlp audio error: ${data}`);
        });

        ytdlp.on('close', async (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Failed to extract audio' });
            }
            const audioBuffer = Buffer.concat(audioChunks);

            try {
                // Updated for Deepgram SDK v3 with paragraphs and sentence-level timestamps
                const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                    audioBuffer,
                    {
                        model: 'nova-2',
                        smart_format: true,
                        punctuate: true,
                        mimetype: 'audio/mp3',
                        paragraphs: true,       // Enable paragraph detection
                        timestamps: true        // Enable word-level timestamps
                    }
                );

                if (error) {
                    console.error('Deepgram error:', error);
                    return res.status(500).json({ error: 'Failed to transcribe audio' });
                }

                const transcript = result.results.channels[0].alternatives[0].transcript;
                const paragraphs = result.results.channels[0].alternatives[0].paragraphs?.paragraphs || [];
                
                // Format paragraphs with start time, end time, and sentences
                const formattedParagraphs = paragraphs.map((paragraph, index) => ({
                    id: index + 1,
                    start: paragraph.start,
                    end: paragraph.end,
                    sentences: paragraph.sentences.map((sentence, sentenceIndex) => ({
                        id: sentenceIndex + 1,
                        start: sentence.start,
                        end: sentence.end,
                        text: sentence.text,
                        words: sentence.words ? sentence.words.map(word => ({
                            word: word.word,
                            start: word.start,
                            end: word.end,
                            confidence: word.confidence || 0
                        })) : []
                    }))
                }));

                res.json({ 
                    transcript,
                    paragraphs: formattedParagraphs,
                    totalParagraphs: formattedParagraphs.length,
                    totalSentences: formattedParagraphs.reduce((total, p) => total + p.sentences.length, 0)
                });
            } catch (err) {
                console.error('Deepgram error:', err);
                res.status(500).json({ error: 'Failed to transcribe audio' });
            }
        });

        ytdlp.on('error', (err) => {
            console.error('Failed to start yt-dlp (audio):', err);
            res.status(500).json({ error: 'Failed to extract audio' });
        });
    } catch (err) {
        console.error('YouTube audio extraction error:', err);
        console.log(error)
        res.status(500).json({ error: 'Failed to extract audio' });
    }
});


// POST /api/youtube/create-reel
// router.post('/create-reel', async (req, res) => {
//     // Create reel logic here
// });

// Serve individual clip video files
// router.get('/clip/:id/:clipIndex', (req, res) => {
//     const tempDir = path.join(__dirname, '../temp');
//     const clipPath = path.join(tempDir, ${req.params.id}_clip${req.params.clipIndex}.mp4);
//     if (fs.existsSync(clipPath)) {
//         res.download(clipPath, clip${req.params.clipIndex}.mp4, (err) => {
//             if (!err) {
//                 // Optionally, clean up temp files after download
//                 // fs.unlinkSync(clipPath);
//             }
//         });
//     } else {
//         res.status(404).json({ error: 'Clip not found' });
//     }
// });

// // Serve the reel video file
// router.get('/reel/:id', (req, res) => {
//     const tempDir = path.join(__dirname, '../temp');
//     const reelPath = path.join(tempDir, ${req.params.id}_reel.mp4);
//     if (fs.existsSync(reelPath)) {
//         res.download(reelPath, 'reel.mp4', (err) => {
//             if (!err) {
//                 // Optionally, clean up temp files after download
//                 // fs.unlinkSync(reelPath);
//             }
//         });
//     } else {
//         res.status(404).json({ error: 'Reel not found' });
//     }
// });

module.exports = router;