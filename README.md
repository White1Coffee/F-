# F-Mineflayer

F-Mineflayer is een Windows-project voor het centraal starten en beheren van meerdere Mineflayer-bots. De bestaande Hub blijft de bron van waarheid voor bots, dashboard, teamwork, viewers, poorten en knowledge merge.

## Snelle installatie met setup.exe

1. Download `F-Mineflayer-Setup-<versie>.exe` en het bijbehorende `.sha256`-bestand uit een release.
2. Controleer desgewenst de checksum met `Get-FileHash .\F-Mineflayer-Setup-<versie>.exe -Algorithm SHA256`.
3. Start de installer, kies een installatiemap en vul de Minecraft-servergegevens in.
4. Kies het aantal bots, hun naamprefix en `offline` of `microsoft`-authenticatie.
5. Laat setup de exacte npm-dependencies uit de lockfiles installeren.
6. Start via **F-Mineflayer Start** en open de dashboardshortcut.

De installer gebruikt standaard `%LOCALAPPDATA%\Programs\F-Mineflayer`. Dit is per gebruiker schrijfbaar en vereist normaal geen administratorrechten. Een niet digitaal ondertekende lokale build kan een Windows SmartScreen-waarschuwing tonen; de build is alleen ondertekend wanneer het buildlog dit uitdrukkelijk meldt.

## Installatie met install.bat

`install.bat` kan los worden gedownload. Het haalt via HTTPS de vaste bootstrap van `White1Coffee/F-` op, valideert de verwachte inhoud en gebruikt Git of anders een GitHub-ZIP.

```bat
install.bat
install.bat -Branch main -InstallDir "C:\F-Mineflayer"
```

Een bestaande map wordt nooit verwijderd. Bij een bestaande installatie vraagt de bootstrap bevestiging en laat setup de gebruikersdata staan.

## Handmatige installatie

```bat
git clone https://github.com/White1Coffee/F-.git
cd F-
setup.bat
```

`setup.bat` werkt onafhankelijk van de huidige working directory. Voor automatische reparatie:

```bat
setup.bat -Repair -NonInteractive
```

Gebruik `-ResetConfig` alleen wanneer de configuratie bewust opnieuw ingesteld moet worden; setup maakt eerst een backup.

## Eerste configuratie

Setup vraagt alleen serverhost, poort, Minecraft-versie, auth, botaantal/namen, Hub-poort en de gewenste dashboard-, viewer-, team- en learningopties. Poorten worden gevalideerd en krijgen bij een conflict een vrij alternatief. De gegenereerde botinstances delen `Bots\official-bot`; de Hub geeft elke instance een eigen ID, username, HUD- en viewerpoort.

De bestaande bronnen van waarheid blijven:

- `Config/settings.json`: bots, servers, team en dashboard;
- `Config/ports.json`: Hub-, HUD- en viewerpoorten;
- `Bots/official-bot/bot-settings.json`: botdefaults bij direct starten;
- environmentvariabelen zoals `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `PORT` en `VIEWER_PORT`: overrides.

## Microsoft-login

Kies `microsoft` als authmethode. Geef nooit een Microsoft-wachtwoord aan setup. De eerste botstart kan via browser/device-code om aanmelding vragen. Auth-caches staan in genegeerde lokale mappen en worden niet gelogd of in de installer opgenomen.

## Meerdere bots

Setup ondersteunt 1 tot 32 instances met unieke namen en poorten. De Hub start iedere instance via dezelfde officiële codebase en blijft verantwoordelijk voor taakverdeling en lifecycle. Namen moeten 3-16 letters, cijfers, `_` of `-` bevatten.

## Starten en stoppen

- `start.bat` voert een korte doctorcheck uit, voorkomt een dubbele Hub, start bots via `/api/bots/action` en opent het dashboard.
- `stop.bat` gebruikt eerst `/api/shutdown`, zodat bots/teamdata netjes afsluiten. Alleen de opgeslagen PID van deze projectmap mag als fallback geforceerd worden gestopt.
- De bestaande `Start.cmd` en `Stop.cmd` blijven beschikbaar voor backward compatibility.

Dashboard: `http://localhost:3100/#overview` (of de gekozen Hub-poort). Viewerlinks staan per bot in de Hub.

In **Owners & Whitelist** stel je per bot de eigenaar en spelers in die Minecraft-chatcommando's mogen geven. De gekozen Hub-botnaam wordt ook als Minecraft-username gebruikt (maximaal 16 geldige tekens). In **Schematics** toont Build status niet alleen verzending, maar ook de lokale wachtrij, voltooiing en echte foutreden. Creative-bots krijgen paletteblokken automatisch; survival-bots moeten de getoonde materialen werkelijk in hun inventory hebben.

In **Settings** kun je de meegeleverde Discord-botbridge koppelen met een bot token. De token blijft uitsluitend in `minecraft-discord-bot\.env`, wordt door Git genegeerd en wordt nooit door de API teruggestuurd. De knop **UPDATE** zoekt naar een fast-forward Git-update of de nieuwste GitHub-release, maakt eerst een backup, werkt alleen programmabestanden en gewijzigde dependencies bij en start Hub en bots opnieuw.

## Diagnose

Start `doctor.bat`. De controle omvat Windows/PowerShell, Node/npm, lockfile-dependencies, entrypoints, JSON, configuratie, unieke poorten, schrijfrechten, knowledge, dashboard/team/auth, actieve projectprocessen en optioneel de Minecraft-server.

- exit `0`: in orde;
- exit `1`: waarschuwingen;
- exit `2`: kritieke fouten.

Doctor wijzigt niets.

## Updates

`update.bat` stopt eerst veilig, maakt een backup en detecteert Git of een gebundelde installatie. Een Git-installatie vereist een schone worktree en gebruikt alleen `fetch` plus een bevestigde `pull --ff-only`. Voor een gebundelde installatie is de aanbevolen update een nieuwere `setup.exe`; die vervangt uitsluitend programmabestanden en laat niet door Inno beheerde runtime-data staan.

## Backups

Configuratiebackups staan onder `backups/config-<datum>-<reden>/`. Setup en update wissen geen `Data`, knowledge, worlds of schematics. Deze backupmappen zijn door Git genegeerd.

## Verwijderen

`uninstall.bat` biedt vier keuzes: alleen programma; programma en logs; alles behalve knowledge/worlds; of volledige verwijdering. Volledige verwijdering vereist exact `VERWIJDER ALLES`. Met `-CreateBackup` wordt eerst een kopie in Documenten gemaakt. De Inno-uninstaller verwijdert geïnstalleerde programmabestanden; later aangemaakte gebruikersdata blijft standaard bestaan.

## Problemen oplossen

- Setupfout: bekijk `Logs/setup.log`.
- Hub start niet: bekijk `Logs/hub.err.log` en voer `doctor.bat` uit.
- Poort bezet: pas de poort in de Hub aan of voer setup opnieuw uit.
- Minecraft niet bereikbaar: controleer host, firewall, serverversie en poort.
- Microsoft-login: verwijder nooit auth-caches tenzij opnieuw aanmelden bewust gewenst is.

Logs redigeren bekende token-/password-/secretvelden. Deel alsnog geen auth-cache of volledige environmentdump.

## Installer bouwen

Vereisten: Windows, PowerShell 5.1+, Node.js conform `.nvmrc` (Node 22), npm en Inno Setup 6. Ontbreekt Node op de doelcomputer, dan biedt interactieve setup installatie via `winget` aan; de `.exe`-installer activeert die gecontroleerde Node.js LTS-installatie automatisch.

```bat
setup.bat -Repair -NonInteractive
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-installer.ps1
build-installer.bat
```

Output:

```text
dist/F-Mineflayer-Setup-1.0.3.exe
dist/F-Mineflayer-Setup-1.0.3.exe.sha256
```

De builder voert tests uit, maakt `installer/staging`, sluit `.git`, `node_modules`, Config, Data, logs, backups, auth, knowledge, worlds en secrets uit, compileert met Inno Setup en schrijft SHA-256. Gebruik `-IsccPath` als `ISCC.exe` niet op de standaardlocatie staat.

Optionele signing gebruikt uitsluitend omgevingsvariabelen:

```text
SIGNTOOL_PATH
SIGN_CERT_THUMBPRINT
SIGN_TIMESTAMP_URL
```

Er staan geen certificaten of signingwachtwoorden in de repository. Zonder deze waarden blijft de build bruikbaar maar expliciet unsigned.

## GitHub Releases

`.github/workflows/build-installer.yml` draait bij `v*`-tags en handmatig. De workflow installeert dependencies, voert Hub-, bot- en installertests uit, bouwt de Inno-installer en publiceert `.exe` plus checksum als artifact. Een release kan dat artifact vervolgens zonder wijziging publiceren.
