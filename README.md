# Post incoming emails to Discord

- Receives inbound emails through ForwardEmail
- Breaks message apart into Discord embeds, then POST it to the specified webhook
- Also use gpt-5-mini to summarize in gen z slang

ForwardEmail paid plan required to prevent spam.

## Configuration

Create a local config file before starting the service:

```sh
cp config_example.yml config.yml
```

Set the webhook URLs, ForwardEmail signature key, Anthropic API key, allowed sender list, and port in `config.yml`.

## Docker

Build the image:

```sh
docker compose build
```

Start the service:

```sh
docker compose up
```

Run in the background:

```sh
docker compose up -d
```

The Compose file mounts `./config.yml` into the container and publishes `${WEBHOOK_PORT:-9010}:${WEBHOOK_PORT:-9010}`. Keep `WEBHOOK_PORT` aligned with the `port` value in `config.yml` if you change the service port.

## Development

Start with the development overlay. This bind-mounts the project and runs the app with `--debug`, which enables debug logging and skips Discord webhook posts:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Run once with debug logging and request-body capture:

```sh
docker compose -f compose.yaml -f compose.dev.yaml run --rm --service-ports discord-email-webhook node index.js --debug --save-body
```

Captured request files are written as `request_body.json` and `request_headers.json`, which are ignored by git.

Send a saved request to the local service:

```sh
pnpm send:localhost
```

PM2 is not used by the Docker runtime; the container runs `node index.js` directly.
