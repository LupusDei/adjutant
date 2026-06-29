# Avatar SDK bundle

Self-hosted bundle for the Bridge avatar page (served at GET /avatar/sdk.js → backend/public/avatar-sdk.js).
Bundles React + react-dom + @runwayml/avatars-react (+ LiveKit) into one same-origin ESM file so the
/avatar page never depends on the esm.sh CDN module graph (which failed on mobile WKWebView).

## Rebuild
```
cd backend/avatar-sdk-build
npm install --no-save react@18 react-dom@18 @runwayml/avatars-react@0.16.0
../node_modules/.bin/esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020 \
  --minify --define:process.env.NODE_ENV='"production"' --outfile=../public/avatar-sdk.js
```
