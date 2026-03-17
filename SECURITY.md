# Security Policy

## Supported Versions

Only the latest `main` branch is considered supported.

## Reporting a Vulnerability

Please do not open public issues for vulnerabilities.

- Email: `security@your-domain.example` (replace before publishing)
- Include steps to reproduce, affected version/commit, and impact.
- You will receive an acknowledgment within 72 hours.

## Security Defaults Checklist

Before public deployment:

1. Set `ENABLE_AUTH=true` and configure strong `JWT_SECRET`.
2. Use HTTPS (TLS) via reverse proxy.
3. Restrict backend binding to trusted networks when possible.
4. Keep host OS and Docker dependencies updated.
5. Rotate SSH keys and avoid password auth where possible.
6. Backup `backend/data` and key material regularly.
