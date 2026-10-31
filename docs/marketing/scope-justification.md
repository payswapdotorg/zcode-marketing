# WO-P1 scope justification — least-privilege confirmation at implementation time

The work order requires the minimal scope set to be **confirmed at
implementation time** as the least-privilege set satisfying WO-P2 (real
publication) and WO-P3 (real measurement). This document is that confirmation.

## Requested scopes and why each is necessary

| Scope | Consumed by | Why it is needed | Why nothing narrower works |
|---|---|---|---|
| `youtube.upload` | WO-P2 `videos.insert` (publication) | Uploading the approved asset is the P2 gate itself | No upload is possible without it; it is the narrowest upload scope |
| `youtube.readonly` | WO-P1 health check (`channels.list?mine=true`); WO-P2 read-back verification (`videos.list`) | The verified channel identity behind the consent, and the independent read-back AT-P2 requires | Channel identity cannot be obtained with zero scopes; `youtube.readonly` is read-only and narrower than any write-capable scope |
| `yt-analytics.readonly` | WO-P3 `reports.query` (YouTube Analytics API) | Real per-video/per-channel metrics are the P3 gate | Metrics are only exposed through this scope; it grants no write or management rights |

## Scopes deliberately NOT requested

- `youtube.force-ssl` — broad write access (manage playlists, subscriptions,
  etc.); not needed for upload-only publication.
- `youtube` (full) — superset of the above; rejected for least privilege.
- `yt-analytics-monetary.readonly` — partner revenue data; not required by any
  Phase 2 gate.
- `userinfo.*` — account profile data; the channel identity from
  `youtube.readonly` suffices and is the identity that matters (the channel,
  not the Google account).
- Any Drive, Calendar, or other-product scopes — irrelevant.

## Runtime re-verification (runbook step 0.3)

Google's consent screen displays exactly what is requested at consent time —
the manual-run recording (artifact 1) is the authoritative confirmation that
only these three scopes were granted. The connection record stores the granted
scope list (`status`/`export` shows it) so drift is detectable later.

## Consequence for downstream work orders

- WO-P2 must not require any scope beyond `youtube.upload` + `youtube.readonly`.
- WO-P3 must not require any scope beyond `yt-analytics.readonly`.
- If either work order discovers it needs more, that is a scope-set change:
  record it in the registry, re-consent, and update this document — never
  silently widen.
