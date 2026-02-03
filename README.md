# Firefly Groove Server

This is a separate, always-on server that fetches songs from APIs, converts audio and thumbnails to base64 without re-encoding, and stores everything in Firebase Realtime Database. It also exposes an admin UI to monitor status and manage fetch queries.

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env` and fill values.
3. Place your Firebase Admin service account JSON at `serviceAccount.json` (or set `FIREBASE_SERVICE_ACCOUNT`).
4. Create `public/config.js` based on `public/config.example.js` for the admin UI Firebase Auth config.
5. Start the server with `npm run start`.

## Dataset import

- Set `CSV_DATASET_PATH` to your CSV (example: `F:\\Songs Dataset\\dataset.csv`).
- Optionally set `CSV_DATASET_URL` to let the server download the file if it is missing.
- The scheduler will import a batch every run, using `DATASET_BATCH_SIZE` rows at a time.
- The dataset drives search queries for audio + thumbnails, then stores the matched tracks.
- Use the Admin UI "Import batch" button to run a dataset batch manually.

## Albums & artists

- Each saved song is grouped into an album using `artist + album` (or `Singles` if album is missing).
- Artist and album metadata are stored under `artists/*` and `albums/*`.

## Notes

- Audio and images are stored as base64, which increases size by about 33 percent. Make sure your Realtime Database plan can handle the storage and bandwidth.
- To stop the scheduler, use the Stop button in the admin UI or set `scheduler/enabled` to false in the database.
- Only metadata is returned by the admin UI. Full audio is stored under `catalog/songs/{id}/audio/chunks`.
