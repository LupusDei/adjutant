# Vercel deploy webhook → Adjutant dashboard

Adjutant exposes a webhook receiver that turns Vercel deployment events into
Timeline entries on the dashboard. This lets you watch deploys land — across
projects — without leaving Adjutant.

- **Endpoint:** `POST /api/webhooks/vercel` (mounted at your Adjutant base URL)
- **Auth:** HMAC-SHA1 signature in `x-vercel-signature` (no API key)
- **Surfaced events:** `deployment.created`, `deployment.succeeded`,
  `deployment.error`, `deployment.canceled`

## 1. Generate a signing secret

Pick any high-entropy string. Vercel will use it to sign every delivery,
and Adjutant will reject anything whose signature doesn't match.

```sh
openssl rand -hex 32
```

Save the value — you'll paste it into both Vercel and Adjutant.

## 2. Configure Adjutant

Add the secret to the Adjutant backend environment. For a local checkout,
that's `backend/.env`:

```env
VERCEL_WEBHOOK_SECRET=<the value from step 1>
```

Restart the backend. Without this var the endpoint returns `503
SERVICE_UNAVAILABLE` and refuses to record events.

## 3. Register the webhook in Vercel

Vercel supports two kinds of webhooks. Either works.

### Option A — Project Webhook (single project)

1. Vercel dashboard → your project → **Settings → Webhooks**.
2. **Create Webhook**, paste the public URL:
   `https://<your-adjutant-host>/api/webhooks/vercel`
3. Tick events: `deployment.created`, `deployment.succeeded`,
   `deployment.error`, `deployment.canceled`.
4. Paste your secret as the **Signing Secret**.

### Option B — Team Webhook (all projects)

1. Vercel dashboard → **Team Settings → Webhooks**.
2. Same URL, same events, same secret.

Either way, copy the URL on the bloomfolio (or other deploying repo) side as
`ADJUTANT_WEBHOOK_URL` so it's easy to re-point if Adjutant moves.

## 4. Test it

From any project that ships to Vercel:

```sh
vercel deploy --prod
```

Within ~60 seconds the deploy appears in the Adjutant **Timeline** tab as a
`DEPLOY` card. Expand it to see:

- Project name
- Environment (Production / Preview)
- Commit SHA — clickable to the GitHub commit
- Deploy URL — clickable
- Vercel inspector URL

For a smoke test without a real deploy, send a signed payload with `curl`:

```sh
SECRET="<your secret>"
BODY='{"type":"deployment.succeeded","createdAt":1700000000000,"payload":{"deployment":{"id":"dpl_test","url":"test.vercel.app","target":"production","meta":{"githubCommitSha":"abc1234567890","githubCommitOrg":"myorg","githubCommitRepo":"myapp"}},"project":{"name":"myapp"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha1 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST https://<your-adjutant-host>/api/webhooks/vercel \
  -H 'Content-Type: application/json' \
  -H "x-vercel-signature: $SIG" \
  --data "$BODY"
```

A `200 { "success": true, "data": { "eventId": "...", "status": "succeeded" } }`
response means the event was recorded.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `503 SERVICE_UNAVAILABLE` | `VERCEL_WEBHOOK_SECRET` not set | Set the env var and restart |
| `400 BAD_REQUEST` "Missing x-vercel-signature header" | Header not sent | Use the Vercel webhook UI; for curl ensure `-H "x-vercel-signature: …"` |
| `401 UNAUTHORIZED` "Invalid webhook signature" | Secret mismatch or body modified in transit | Confirm the secret in Vercel matches `VERCEL_WEBHOOK_SECRET` exactly |
| `200 { "ignored": true }` | Event type is outside the surfaced set (e.g., `project.created`) | Expected — Adjutant only records deployment events |

## What the dashboard sees

Each accepted webhook becomes a `deploy_status` Timeline event with this
detail payload:

```json
{
  "source": "vercel",
  "vercelEventType": "deployment.succeeded",
  "status": "succeeded",
  "projectName": "bloomfolio",
  "projectId": "prj_…",
  "environment": "Production",
  "deployUrl": "https://bloomfolio-….vercel.app",
  "deploymentId": "dpl_…",
  "commitSha": "0123456789…",
  "commitShaShort": "0123456",
  "githubOrg": "myorg",
  "githubRepo": "bloomfolio",
  "commitUrl": "https://github.com/myorg/bloomfolio/commit/0123456789…",
  "inspectorUrl": "https://vercel.com/myorg/bloomfolio/dpl_…",
  "occurredAt": "2026-05-15T00:00:00.000Z"
}
```

The status color on the Timeline card reflects deploy outcome: cyan for
created, green for succeeded, red for error, grey for canceled.
