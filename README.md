# MaxBot

MAX Mini App and bot backend.

## Deployment

See [deployment instructions](README-DEPLOY.md).

Requirements: Ubuntu VPS with public IPv4, a domain pointed to the VPS, inbound TCP ports 80 and 443, Docker Engine, Docker Compose v2, and a MAX bot token.

Run `sudo bash deploy/setup.sh` from the deployment package. The installer asks for the bot token and domain, obtains a Let's Encrypt certificate, and starts the application.
