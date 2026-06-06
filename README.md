# phototrol-face-embed

Standalone Node sidecar for PhotoTrol AI face recognition (face-api.js 128-d descriptors).

## One-line install (DigitalOcean Ubuntu console)

After pushing this repo to GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/phototrol-face-embed/main/install-ubuntu.sh | SIDECAR_GIT_URL=https://github.com/YOUR_USER/phototrol-face-embed.git bash
```

Or without git (release tarball URL):

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/phototrol-face-embed/main/install-ubuntu.sh | SIDECAR_RELEASE_URL=https://github.com/YOUR_USER/phototrol-face-embed/releases/download/v1.0.0/face-embed.tar.gz bash
```

## What the installer does

1. Installs Node 20, cloudflared, canvas native build deps
2. Clones or extracts sidecar into `/opt/face-embed`
3. `npm install` + `npm run fetch-models`
4. Generates `/root/.face-embed-key`
5. Starts sidecar on `127.0.0.1:8723`
6. Starts `cloudflared tunnel --url http://127.0.0.1:8723`
7. Prints `SetEnv` lines for HostGator `.htaccess`

## Push to GitHub (one-time, from Laragon)

```bat
cd C:\laragon\www\_deploy\phototrol-face-embed-sidecar
git init
git add .
git commit -m "PhotoTrol face-embed sidecar installer"
gh repo create phototrol-face-embed --public --source=. --push
```

Replace `YOUR_USER` in the one-liner with your GitHub username.

## Production note

`trycloudflare.com` URLs change when the tunnel restarts. For production, bind `0.0.0.0:8723`, allowlist HostGator IP `192.185.4.29`, and set `FACE_EMBED_URL=http://VPS_IP:8723` instead of the tunnel URL.
