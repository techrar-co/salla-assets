# Salla Assets

This repo contains two separate pieces:

- `snippet/salla-storefront-snippet.js`: the storefront snippet source
- `mock-server/`: the local Salla mock server

## jsDelivr delivery

The simplest temporary production setup for this repo is:

1. Keep the snippet source in `snippet/salla-storefront-snippet.js`.
2. Build a minified release into `dist/salla/releases/`.
3. Publish a plain semver git tag like `0.1.0`.
4. Let Salla load the stable major-alias URL instead of `@main`.

Recommended Salla bootstrap target while the project is on `0.x`:

```text
https://cdn.jsdelivr.net/gh/techrar-co/salla-assets@0/dist/salla/current.js
```

Why this repo does **not** recommend `@main` or a bare `@latest` URL:

- branch URLs are not deterministic enough for production
- `@latest` tracks the latest semver release, which is broader than needed
- jsDelivr alias URLs are cache-heavy, so a stable major alias is safer than following a branch

## Commands

Install the tiny root toolchain once:

```bash
npm install
```

Build the current package version into `dist/salla/`:

```bash
npm run build:jsdelivr
```

Create a release commit and git tag:

```bash
npm run release:jsdelivr -- --bump patch
```

Create and push the release in one command:

```bash
npm run release:jsdelivr -- --bump patch --push
```

You can also force an explicit version:

```bash
npm run release:jsdelivr -- --version 0.2.0 --push
```

## Release outputs

Each build writes:

- `dist/salla/current.js`: stable pointer file for jsDelivr alias URLs
- `dist/salla/bootstrap.inline.js`: copy/paste bootstrap snippet for Salla
- `dist/salla/releases/salla-storefront-snippet.<version>.min.js`: immutable release asset
- `dist/salla/release.json`: generated metadata and URLs
- `dist/salla/purge-urls.txt`: alias URLs to paste into jsDelivr purge

## Purge and cache reality

jsDelivr’s public purge flow is not a normal authenticated dashboard flow. The public tool is reCAPTCHA-gated, so this repo only prepares the purge URLs for you instead of attempting a blind auto-purge.

Use:

```text
https://www.jsdelivr.com/tools/purge
```

Paste the contents of:

```text
dist/salla/purge-urls.txt
```

Important limitation:

- alias URLs on jsDelivr are still cache-heavy
- on 2026-03-29, `@main` and semver-alias responses both returned `Cache-Control: public, max-age=604800, s-maxage=43200`
- exact version URLs returned `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`

That means this setup is fine as a temporary, low-ops delivery path, but it is not a strong substitute for a first-party CDN when you need fast rollout or rollback.
