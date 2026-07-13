# Minecraft Bot Starter

## Live teamwork

The Hub owns temporary team goals, assignments, reservations and the verified inventory ledger. Bots register with a unique runtime instance ID and send heartbeats over the existing HUD telemetry Socket.IO connection. Persistent operational state is written atomically to `Data/team-state.json`; live heartbeat positions remain in memory.

The Teamwork tab and `/api/team/*` routes expose bots, goals, tasks, reservations and inventory. The first deterministic template is `obtain_iron_ingots`. Tasks are filtered by world and capability, offered to one bot, accepted in two steps and executed through that bot's existing skill registry and task manager.

After a Hub restart, completed tasks stay completed while interrupted work becomes available again. Heartbeat timeout or disconnect releases assignments and reservations. Set `team.enabled` to `false` in `Config/settings.json` to disable teamwork.

## Team Management Dashboard

Start the existing Hub and open `http://localhost:3100`. The integrated SPA includes Overview, Bots, Team Goals, Tasks, Skills & Learning, Inventory & Logistics, Events & Logs and Dashboard Settings.

## Schematics

The Schematics tab stores validated Sponge `.schem` v2/v3 files under `Data/schematics`. Select an exact integer X/Y/Z corner anchor, rotation and a primary online bot. The helper list only offers capable bots on the same server within 64 blocks of that anchor; each helper must be explicitly checked. Building runs through the bot's normal `TaskManager` and `buildSchematic` skill. Bots place only blocks present in their inventories, never execute file content as code, and stop on danger, cancellation, missing materials or failed validation. Uploads are limited to 8 MB and 250,000 schematic positions.

Bot status and team changes arrive through `/api/dashboard/stream` using a reconnecting Server-Sent Events connection. The existing three-second polling remains as a compatibility fallback. Fast position notices are throttled; experiences and skill summaries refresh at a slower interval; event and API results are bounded and paginated.

Dashboard control actions are accepted from localhost. When the Hub is exposed to another machine, set `DASHBOARD_TOKEN` in the Hub environment and send it as `X-Dashboard-Token`. Reconnect, emergency stop, goal cancellation and task cancellation require explicit confirmation. Debug mode is disabled by default and never exposes environment variables or authentication data.

Dashboard API groups:

```text
/api/dashboard/*
/api/team/*
/api/learning/*
/api/logistics/*
/api/world/*
/api/events
```

Run Hub tests with `npm test` from the `Hub` folder. No Minecraft login is required for these tests.

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
