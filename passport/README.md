# ID Photo — passport & visa photo app (iPhone)

Installable web app (PWA). Runs fully on-device: photos never leave the phone.

## Install on iPhone
1. Host this folder over HTTPS (e.g. GitHub Pages → `https://<user>.github.io/tom-mealplanner/passport/`).
2. Open it in **Safari** → Share → **Add to Home Screen**. It then launches full-screen and works offline after the first load.

Camera access requires HTTPS (or `localhost`).

## Workflow
1. **Format** — pick the country/document (UK, Germany, Schengen, France, US, Canada, Brazil, UAE, or add your own).
2. **Capture** — live camera with head-oval guide and 3 s timer, or pick from Photos (best quality: let someone else shoot with the rear camera, ~1.5 m).
3. **Align** — on-device face landmarking (MediaPipe) levels the eyes, sets chin/crown markers and scales the head to the spec. Drag / pinch / twist to fine-tune; drag the yellow crown & chin markers and tap *Fit to markers*. Live chips show head height in mm vs. the allowed range, top gap, centring, eye level and effective source DPI.
4. **Light** — auto levels/exposure, plus brightness, contrast, shadows, warmth, saturation. Hold the ◐ button to compare with the original.
5. **Export** — single photo at 600 dpi (online applications) or a tiled print sheet (6×4 in / A4, 300 dpi) via the iOS share sheet.

## Adding a country
Either use *+ Add custom format* in the app (stored on the device), or add an entry to `specs.js` with the official source URL. Mark it `status: 'approx'` unless the head-size figure comes from the issuing authority.

## Limits — read before relying on it
- Specs marked **VERIFY** (Brazil, UAE) have no official head-size figure; values are derived from third-party guidance.
- Germany: since 1 May 2025 Bürgerämter accept only digital photos from certified photographers or taken on-site. Self-made prints are for consulates/other uses — check first.
- UK and others prohibit retouching. Keep light adjustments modest; the app does **not** replace backgrounds — shoot against a compliant wall.
- The crown marker is estimated from the forehead landmark (hair isn't a landmark). Always check it sits at the top of the head.
