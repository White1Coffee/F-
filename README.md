# Minecraft AI Bot USB

Portable layout for the Minecraft AI Bot Hub on this USB stick.

## Start

Run `Start.cmd` from `F:\`. The web Hub starts on:

`http://localhost:3100`

`Start.cmd` first runs `Tools\scripts\check-system.ps1` and creates a startup
backup in `Data\backups\startup\`. The Hub keeps `Config\ports.json`
synchronized and automatically moves a bot to a free HUD/viewer port pair when
its configured pair is unavailable.

The hub starts registered bots from `Bots\` and writes shared hub logs to `Logs\hub`.

## Install dependencies

`node_modules` folders are not stored in git. After copying or cloning this
project, install dependencies before starting the Hub:

```cmd
cd /d F:\Hub
..\Node\npm.cmd install

cd /d F:\Bots
..\Node\npm.cmd install
```

The Discord bridge does not currently need extra npm packages.

## Stop

Run `Stop.cmd` from `F:\` to stop the hub and bot Node processes that were started from this USB layout.

## Layout

- `Hub\` contains the hub UI/server.
- `Bots\` contains the Minecraft bot projects.
- `Config\settings.json` registers bot folders, server hosts, ports and hub groups.
- `Config\ports.json` documents the assigned hub, HUD and viewer ports.
- `Data\knowledge\merged` is used for merged knowledge exports.
- `Data\backups\update-backups` is used for hub code-update backups.
- `Logs\hub` contains hub-managed bot logs.
