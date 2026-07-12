# Minecraft Bot Starter

Standalone local Hub for managing copied Minecraft AI bot folders.

## Install

```powershell
cd C:\minecraft-bot-starter
npm install
```

## Start

```powershell
npm start
```

Or open `start-hub.cmd`.

The Hub runs at:

```text
http://localhost:3100
```

Use **Choose folder** to register each copied bot folder. Every bot can have its
own Minecraft server, HUD port and viewer port. **Turn on** opens a visible CMD
window and starts that bot with the selected values.

Knowledge merge accepts between 2 and 5 stopped bots. Results are written to a
new timestamped folder inside `merged-knowledge/`; source folders are never
modified.

## Management

The **Manage** tab includes bot groups, group start/stop, server profiles,
Amsterdam-local scheduled actions, searchable console logs, knowledge
comparison, merge history/restore and safe code updates.

Bot registrations inside the shared parent folder are saved as portable paths
starting with `@/`. Copying the shared parent folder to a USB drive or another
computer therefore keeps those registrations working.
