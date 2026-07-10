# Codorobot production runbook

## Required secrets

Before `NODE_ENV=production`, set real values for:

- `VK_GROUP_TOKEN`, `VK_CONFIRMATION_CODE`, `VK_SECRET`
- `MOYKLASS_API_KEY`
- `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`
- `JOB_SECRET`, `ADMIN_CSRF_SECRET`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`

Production startup intentionally fails when payment test mode is enabled, required secrets are empty, or the admin password is still `change-me`.

## Deploy

1. Pull the release on the VPS.
2. Review `.env` and keep `PAYMENT_TEST_MODE=false`.
3. Run `docker compose build backend`.
4. Run `docker compose up -d postgres backend traefik`.
5. Migrations run automatically from the backend container startup command.

## Smoke check

```bash
curl -fsS https://$BASE_HOST/health
curl -fsS https://$BASE_HOST/ready
curl -fsS -X POST "https://$BASE_HOST/jobs/process-vk-events" -H "X-Job-Token: $JOB_SECRET"
curl -fsS -X POST "https://$BASE_HOST/jobs/process-moyklass-sync" -H "X-Job-Token: $JOB_SECRET"
```

In VK callback settings, confirm `/webhooks/vk` with the configured confirmation code. In T-Bank, keep the notification URL at `/webhooks/tbank`.

## Scheduled jobs

Use cron or the VPS scheduler with `X-Job-Token`:

- `/jobs/process-vk-events` every minute
- `/jobs/process-moyklass-sync` every 2-5 minutes
- `/jobs/expire-payments` every 5 minutes
- `/jobs/send-trial-reminders` once per day

## Backup and restore

Create a daily backup:

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "backup-$(date +%F).dump"
```

Restore to an empty database:

```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backup.dump
```

## Logs and privacy

JSONL logs are retained for `LOG_RETENTION_DAYS`. Do not copy raw logs into chats or tickets unless they were reviewed for personal data first.

## Secret rotation

Rotate one external secret at a time, update `.env`, restart `backend`, then run the smoke checks above. For `JOB_SECRET`, update every scheduler entry at the same time.
