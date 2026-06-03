# Persistent local dev servers (launchd)

Keeps the API (`:3000`) and Vite frontend (`:5273`) running independently of
any Claude/terminal session. They **auto-restart on crash, Mac sleep/wake, and
login** (`KeepAlive` + `RunAtLoad`), so they stop dropping out during the day.

## Install / update

```bash
cp tools/local-dev/com.tck.dev-api.plist      ~/Library/LaunchAgents/
cp tools/local-dev/com.tck.dev-frontend.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tck.dev-api.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tck.dev-frontend.plist
```

## Everyday commands

```bash
# Status (PID in col 1, last exit code in col 2)
launchctl list | grep com.tck.dev

# Restart after editing API code (the API doesn't hot-reload; Vite does)
launchctl kickstart -k gui/$(id -u)/com.tck.dev-api

# Logs
tail -f ~/Library/Logs/tck-dev-api.log
tail -f ~/Library/Logs/tck-dev-frontend.log
```

## Stop / uninstall

```bash
launchctl bootout gui/$(id -u)/com.tck.dev-api
launchctl bootout gui/$(id -u)/com.tck.dev-frontend
rm ~/Library/LaunchAgents/com.tck.dev-{api,frontend}.plist
```

## Notes
- These own ports 3000 / 5273. Don't also start the servers via the Claude
  Preview tool or `pnpm dev` in a terminal — that double-binds the port.
- The frontend uses `--strictPort`, so if `:5273` is taken it errors instead of
  silently moving to another port (makes a port clash obvious in the log).
