# StemSplit

Free in-browser vocal remover & stem splitter, plus 5 bonus audio tools. Everything runs 100% on the user's device — no backend, no uploads, no accounts.

**Live tools**
- `studio.html` — Stem Splitter Studio: upload/record audio or video → separate Vocals & Music stems → preview → custom mix → download WAVs / ZIP
- `pitch-shifter.html` — transpose ±12 semitones (tape-style)
- `bpm-key-finder.html` — tempo + musical key detection
- `audio-cutter.html` — waveform region trim
- `audio-joiner.html` — merge multiple tracks
- `speed-changer.html` — 0.25×–2.5× speed

**How it works (tech)**
- `js/audio-engine.js` — pure DSP core (mid/side separation, WAV encoder, FFT, BPM + key detection). Written dependency-free and unit-tested: `node test/engine-test.js`
- `js/studio.js`, `js/tools.js`, `js/site.js` — UI wiring (Web Audio API)
- `css/style.css` — original dark design system
- Only CDN dependency at runtime: JSZip (for "download all stems") + Google Fonts

## Publishing on GitHub Pages (step-by-step)

The site is 100% static, so GitHub Pages hosts it free with no build step.

1. **Create the repository** — on github.com, click **+ → New repository**. Name it `stemsplit` (or anything), set it **Public**, and create it **without** a README (we already have one).
2. **Upload the files** — on the new repo page click **"uploading an existing file"**, then drag in **everything** from this folder (`index.html`, `studio.html`, `css/`, `js/`, `test/`, all the tool pages, `README.md`). Keep the folder structure. Click **Commit changes**.
3. **Enable Pages** — go to **Settings → Pages** (left sidebar). Under **Build and deployment → Branch**, choose `main` and `/ (root)`, then **Save**.
4. **Wait ~1 minute**, then refresh the Pages settings — GitHub shows your live URL, like `https://YOUR-USERNAME.github.io/stemsplit/`.
5. **Test it** — open the URL, go to the Studio, drop in an MP3 and split it. Try one tool page too.

**To update the site later:** edit files locally (or directly on github.com via the pencil icon), commit, and Pages redeploys automatically within a minute.

## Local preview (optional)

Any static server works, e.g.:

```bash
cd stemsplit
python3 -m http.server 8000
# open http://localhost:8000
```

Note: open `index.html` directly via `file://` for layout, but audio decoding and some features need `http://` — use the server above for full testing.
