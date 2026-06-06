// Phototrol face-embed sidecar — loopback-only HTTP service.
//
// Embeds face images into the same 128-d vector space the Phototrol browser
// uses, so the descriptors land in `pht_faces.descriptor_json` interchangeably
// with browser-side uploads. No re-embedding migration required.
//
// Model lock-in (DO NOT CHANGE without a full re-embed of pht_faces):
//   - tinyFaceDetector       — fast bbox proposals
//   - faceLandmark68Net      — 68-point landmarks (used for alignment)
//   - faceRecognitionNet     — 128-d ResNet descriptor (the vector space)
//
// Auth: every request must carry x-embed-key matching env FACE_EMBED_SHARED_KEY.
//       PHP calls this over loopback (127.0.0.1) so the key is the secondary
//       defense; binding only to localhost is the primary defense.
//
// Endpoints:
//   GET  /healthz            — liveness probe, returns { ok, models_loaded, version }
//   POST /embed              — body: multipart 'image' OR JSON { url }
//                              returns: { ok, faces: [{ bbox, score, descriptor[128] }] }

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import express from 'express';
import multer from 'multer';
import * as tf from '@tensorflow/tfjs-node';
import * as faceapi from '@vladmandic/face-api';
import * as canvasPkg from 'canvas';

const { Canvas, Image, ImageData, loadImage } = canvasPkg;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR   = process.env.FACE_EMBED_MODELS_DIR  || path.join(__dirname, 'models');
const PORT         = parseInt(process.env.FACE_EMBED_PORT || '8723', 10);
const BIND_ADDR    = process.env.FACE_EMBED_BIND         || '127.0.0.1';
const SHARED_KEY   = process.env.FACE_EMBED_SHARED_KEY   || '';
const MAX_MB       = parseInt(process.env.FACE_EMBED_MAX_MB || '12', 10);
const DETECT_SIZE  = parseInt(process.env.FACE_EMBED_DETECT_SIZE || '416', 10);
const SCORE_FLOOR  = parseFloat(process.env.FACE_EMBED_SCORE_FLOOR || '0.5');

if (!SHARED_KEY) {
  console.error('[face-embed] FACE_EMBED_SHARED_KEY env is required');
  process.exit(1);
}

const upload = multer({ limits: { fileSize: MAX_MB * 1024 * 1024 } });

let modelsLoaded = false;
async function loadModels() {
  if (modelsLoaded) return;
  // Sanity check: every face-api expected file is present.
  const required = [
    'tiny_face_detector_model-weights_manifest.json',
    'face_landmark_68_model-weights_manifest.json',
    'face_recognition_model-weights_manifest.json',
  ];
  for (const f of required) {
    try {
      await fs.access(path.join(MODELS_DIR, f));
    } catch {
      throw new Error(`model file missing: ${MODELS_DIR}/${f}. Run 'npm run fetch-models' first.`);
    }
  }
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  modelsLoaded = true;
  console.log('[face-embed] models loaded from', MODELS_DIR);
}

const app = express();
app.use(express.json({ limit: `${MAX_MB}mb` }));
app.disable('x-powered-by');

// Auth gate (skip for /healthz so external probes work without the key).
app.use((req, res, next) => {
  if (req.path === '/healthz') return next();
  const got = String(req.get('x-embed-key') || '').trim();
  if (!got || got !== SHARED_KEY) {
    return res.status(401).json({ ok: false, error: 'bad_key' });
  }
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    models_loaded: modelsLoaded,
    version: '0.1.0',
    detect_size: DETECT_SIZE,
    score_floor: SCORE_FLOOR,
  });
});

app.post('/embed', upload.single('image'), async (req, res) => {
  try {
    if (!modelsLoaded) await loadModels();

    // Resolve the image: prefer multipart, fall back to JSON { url }.
    let imageBuffer = null;
    if (req.file && req.file.buffer) {
      imageBuffer = req.file.buffer;
    } else if (req.body && typeof req.body.url === 'string' && req.body.url.length > 0) {
      const url = req.body.url;
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ ok: false, error: 'bad_url' });
      }
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) {
        return res.status(502).json({ ok: false, error: 'fetch_failed', code: r.status });
      }
      const ab = await r.arrayBuffer();
      if (ab.byteLength > MAX_MB * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'too_large' });
      }
      imageBuffer = Buffer.from(ab);
    } else {
      return res.status(400).json({ ok: false, error: 'missing_image' });
    }

    const img = await loadImage(imageBuffer);
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: DETECT_SIZE,
      scoreThreshold: SCORE_FLOOR,
    });
    const detections = await faceapi
      .detectAllFaces(img, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const faces = detections.map((d) => {
      const box = d.detection.box;
      return {
        bbox: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.width),
          h: Math.round(box.height),
        },
        score: Number(d.detection.score.toFixed(4)),
        descriptor: Array.from(d.descriptor),
      };
    });

    res.json({
      ok: true,
      width: img.width,
      height: img.height,
      faces,
      face_count: faces.length,
    });
  } catch (err) {
    console.error('[face-embed] embed error:', err);
    res.status(500).json({ ok: false, error: 'embed_failed', detail: String(err && err.message || err) });
  }
});

// Pre-warm: load models at startup so first /embed is fast.
loadModels()
  .then(() => {
    app.listen(PORT, BIND_ADDR, () => {
      console.log(`[face-embed] listening http://${BIND_ADDR}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[face-embed] startup failed:', err);
    process.exit(1);
  });
