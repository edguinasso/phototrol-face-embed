# face-api.js model weights

This directory should contain seven files from face-api.js v0.22.2:

```
tiny_face_detector_model-weights_manifest.json
tiny_face_detector_model-shard1
face_landmark_68_model-weights_manifest.json
face_landmark_68_model-shard1
face_recognition_model-weights_manifest.json
face_recognition_model-shard1
face_recognition_model-shard2
```

They're not committed to keep the repo small. To populate:

```bash
npm run fetch-models
```

Total: ~6.5 MB. Downloaded from the pinned upstream tag in `fetch-models.js`.

**Don't change the pinned tag** without a full re-embed of every existing
`pht_faces` row — different weights = different vector space.
