// Download the three face-api.js model files from the upstream repo to ./models/.
// Run this once on first deploy: `npm run fetch-models`. Idempotent — files that
// already exist with non-zero size are skipped.
//
// Source: justadudewhohacks/face-api.js master @ commit-pinned tag. We pin to a
// specific tag so a sidecar redeploy can't pull silently different weights and
// drift the descriptor space.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, 'models');

// Pinned to face-api.js v0.22.2 weights (the same the Phototrol browser ships).
const BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/0.22.2/weights';

const FILES = [
  // tinyFaceDetector
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  // faceLandmark68Net
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  // faceRecognitionNet
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

await fs.promises.mkdir(MODELS_DIR, { recursive: true });

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const name of FILES) {
  const dest = path.join(MODELS_DIR, name);
  try {
    const stat = await fs.promises.stat(dest);
    if (stat.size > 0) {
      console.log(`[skip]  ${name}  (already ${stat.size} bytes)`);
      skipped++;
      continue;
    }
  } catch { /* not present — proceed to download */ }

  const url = `${BASE}/${name}`;
  process.stdout.write(`[get]   ${name}  ... `);
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await pipeline(r.body, fs.createWriteStream(dest));
    const size = (await fs.promises.stat(dest)).size;
    console.log(`${size} bytes`);
    downloaded++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
if (failed > 0) process.exit(1);
