# Recorded synthetic walkthrough

[Watch or download the actual recording](creditdesk-2026-10-25.webm).

- Recorded from https://creditdesk.roshanaryal.com on 25 October 2026.
- Deployed source: `c5e30cedbb877bbfc357bc056df0c4e9eb4f31fa`.
- Actual decoded duration: 180.44 seconds; 1440 by 900 pixels.
- Silent, with explanatory captions added to the browser view. No generated
  voice, fabricated screenshots or privileged session is used.
- The public credit analyst session is read-only. No decision or data mutation
  is made during recording. All displayed records are fictional.
- File size: 19,562,697 bytes (WebM).
- SHA-256: `d983c0753daec8750a43949698b77babafacec67202905f38cd0fa1e4f242a70`.

The thirteen scenes cover sign-in, queue, overview, clients, dated activity,
collections, client collateral, Invoice Check, Portfolio Watch, unsigned memo,
Trust Panel and checksum-verified decision replay. The adjacent
[manifest](creditdesk-2026-10-25.json) records the scene captions, routes and
source commit. Playback and seeking were verified at 5, 110 and 175 seconds;
the decoded frames were inspected for rendered content and readable captions.

## Reproduce

The recording tool is separate from the application dependency tree. The
verified run used an isolated Playwright 1.64.1 runner (Apache-2.0), installed
Chrome and Playwright's FFmpeg helper. The script never requests a password or
loads the operator's existing browser profile.

```bash
npm install --prefix /tmp/creditdesk-recording --no-save --package-lock=false playwright@1.64.1
/tmp/creditdesk-recording/node_modules/.bin/playwright install ffmpeg
PLAYWRIGHT_PACKAGE=/tmp/creditdesk-recording/node_modules/playwright \
BROWSER_CHANNEL=chrome \
DEMO_RECORD_COMMIT=replace_with_verified_hosted_commit \
WALKTHROUGH_OUTPUT=/tmp/creditdesk-walkthrough.webm \
node scripts/record-walkthrough.mjs
```

Replace the commit placeholder with the source actually deployed on the
canonical site. Public demo access must already be enabled on its fictional
fixture database. The script refuses an existing output, checks loaded pages
and replay, then closes the browser context before saving the video. Failed
runs do not publish a completed recording. Review playback and the manifest
before linking a replacement.
