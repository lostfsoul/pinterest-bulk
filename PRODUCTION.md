# Private VPS Production Deployment

This application is designed to run as one backend container with one Uvicorn
worker. Do not scale it to multiple replicas while it uses SQLite and in-process
generation jobs.

## Required configuration

- Set `PRODUCTION_MODE=true`.
- Set strong, different values for `APP_PASSWORD` and `APP_SESSION_SECRET`.
- Set `PUBLIC_BASE_URL` to the public HTTPS origin.
- Terminate TLS at the reverse proxy and forward requests to port `8000`.
- Keep the default bounded scrape concurrency unless the VPS has been load-tested.

## Persistent storage

Mount persistent volumes for both:

- `/app/data`: SQLite database.
- `/app/storage`: templates, fonts, rendered pins, exports, and backups.

The application writes periodic SQLite backups to `/app/storage/backups`.
Copy that directory to separate infrastructure as part of the VPS backup policy.

## Runtime

- Run exactly one application container and one Uvicorn worker.
- Use the Docker health check at `/api/health`.
- Restart the container automatically after failures.
- Monitor free disk space, generation job failures, and backup timestamps.
