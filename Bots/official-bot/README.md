# Minecraft AI Bot - Installeren En Starten

## Betrouwbare taak- en learninglaag

`bot.js` blijft het compatibele entrypoint. De bestaande runtime gebruikt daarnaast een centrale `TaskManager` voor plannerwerk: één actieve hoofdtaak, een prioriteitsqueue, preëmptie, `AbortController`-cancellation, timeouts en maximaal drie gewijzigde pogingen. De planner kiest alleen geregistreerde high-level skills; Mineflayer en pathfinder voeren de lage acties uit.

Geleerde records staan in `knowledge/learned.json` met `schemaVersion: 2`. Dit bestand bevat compacte ervaringen, skillstatistieken en wereldlocaties. Iedere wereldlocatie heeft een gehashte `worldId` op basis van host, poort, Minecraft-versie en geconfigureerde wereldnaam. Bij migratie wordt eerst een kopie in `knowledge-backups/schema-*` gemaakt. Schrijven gebeurt atomisch via een tijdelijk bestand en rename.

De skillketen omvat veiligheid, voedsel, navigatie, hout, planken, crafting table, tools, steen, oven, ijzer, smelten, terugkeren en opslag. Zonder externe AI-API blijft deze keten deterministisch bruikbaar. De bestaande commando's, HUD-events, viewer en Hub-poorten blijven beschikbaar; de HUD-update heeft alleen nieuwe velden gekregen onder andere `reliableTask`, `activeSkill`, `currentPlan` en curriculumstatus.

Tests draaien zonder Minecraft-login of publieke server:

```powershell
cd F:\Bots\official-bot
npm test
```

Een directe start blijft:

```powershell
cd F:\Bots\official-bot
node bot.js
```

Voor multi-botgebruik blijft `F:\Start.cmd` de aanbevolen route. Bestaande knowledge hoeft niet handmatig te worden aangepast; `learned.json` wordt bij de eerste save aangemaakt en oude versies worden automatisch geback-upt en gemigreerd.

Deze handleiding geldt voor elke botmap, bijvoorbeeld:

```powershell
C:\minecraft-ai-bots\minecraft-ai-bot-1
C:\minecraft-ai-bots\minecraft-ai-bot-20
```

Elke bot moet vanuit zijn eigen map gestart worden. Laat meerdere bots nooit dezelfde `PORT`, `VIEWER_PORT` of datafolder delen.

## 1. Benodigdheden Installeren

Installeer eerst Node.js. `npm` wordt automatisch mee geinstalleerd met Node.js.

1. Ga naar:
   https://nodejs.org/
2. Download de **LTS** versie voor Windows.
3. Installeer Node.js met de standaard opties.
4. Sluit PowerShell/CMD en open daarna een nieuwe PowerShell.
5. Controleer of alles werkt:

```powershell
node -v
npm -v
```

Als beide commands een versie tonen, is Node.js/npm klaar.

## 2. Bot Dependencies Installeren

Ga naar de botmap en installeer de packages:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-1
npm install
```

Doe dit voor elke botmap die je op een nieuwe computer wilt gebruiken. Als je de hele map inclusief `node_modules` kopieert, kan het soms al werken, maar `npm install` is schoner en betrouwbaarder.

De viewer package hoort normaal in `package.json` te staan. Als de viewer ontbreekt:

```powershell
npm install prismarine-viewer --save
```

## 3. Een Enkele Bot Starten

Voor een offline/local bot:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-1
$env:MC_HOST="localhost"
$env:MC_PORT="25565"
$env:MC_USERNAME="bot1"
$env:MC_AUTH="offline"
$env:PORT="3010"
$env:VIEWER_PORT="3011"
node bot.js
```

Voor een Microsoft account:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-20
$env:MC_HOST="Davey0.aternos.me"
$env:MC_PORT="25565"
$env:MC_USERNAME="jouw-email@example.com"
$env:MC_AUTH="microsoft"
$env:PORT="3130"
$env:VIEWER_PORT="3131"
node bot.js
```

Bij Microsoft login kan er een login-link/code in de terminal verschijnen. Open die link, log in met het Microsoft account en wacht tot de bot verder gaat.

## 4. Meerdere Bots Starten

Elke bot heeft eigen poorten nodig:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-2
$env:PORT="3012"
$env:VIEWER_PORT="3013"
$env:MC_USERNAME="bot2"
$env:MC_AUTH="offline"
node bot.js
```

Voorbeeld-poorten:

| Bot | HUD | Viewer |
| --- | --- | --- |
| bot1 | 3010 | 3011 |
| bot2 | 3012 | 3013 |
| bot3 | 3014 | 3015 |
| bot4 | 3016 | 3017 |
| bot5 | 3018 | 3019 |
| bot6 | 3020 | 3021 |
| bot7 | 3022 | 3023 |
| bot8 | 3024 | 3025 |
| bot9 | 3026 | 3027 |
| bot10 | 3028 | 3029 |
| bot11 | 3030 | 3031 |
| bot12 | 3032 | 3033 |
| bot13 | 3034 | 3035 |
| bot14 | 3036 | 3037 |
| bot15 | 3038 | 3039 |
| bot16 | 3040 | 3041 |
| bot17 | 3042 | 3043 |
| bot18 | 3044 | 3045 |
| bot19 | 3046 | 3047 |
| bot20 | 3048 | 3049 |

Je mag andere vrije poorten gebruiken. Als een HUD niet opent, is de poort waarschijnlijk al bezet.

## 5. Snelle Start Per Bot

Gebruik dit patroon:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-<nummer>
$env:PORT="<vrije-hud-poort>"
$env:VIEWER_PORT="<vrije-viewer-poort>"
$env:MC_USERNAME="bot<nummer>"
$env:MC_AUTH="offline"
node bot.js
```

Voor bot20 met Microsoft account:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-20
$env:PORT="3130"
$env:VIEWER_PORT="3131"
$env:MC_USERNAME="b4rt22006@gmail.com"
$env:MC_AUTH="microsoft"
node bot.js
```

## 6. Instellingen Zonder Code Aanpassen

De bot leest instellingen uit:

```powershell
bot-settings.json
```

Je kunt ook environment variables gebruiken bij het starten:

```powershell
$env:MC_HOST="localhost"
$env:MC_PORT="25565"
$env:MC_USERNAME="bot1"
$env:MC_AUTH="offline"
$env:PORT="3010"
$env:VIEWER_PORT="3011"
node bot.js
```

Environment variables overschrijven de standaard startinstellingen voor die sessie.

## 7. Knowledge Mergen

Stop de bots eerst. Merge daarna knowledge folders:

```powershell
npm run merge-knowledge -- C:\minecraft-ai-bots\minecraft-ai-bot-1\knowledge C:\minecraft-ai-bots\minecraft-ai-bot-2\knowledge C:\merged-knowledge
```

Daarna:

1. Controleer `C:\merged-knowledge`.
2. Stop de doelbot.
3. Maak een backup van de oude `knowledge` map.
4. Vervang de `knowledge` map door de merged knowledge.
5. Start de bot opnieuw.

## 8. Problemen Oplossen

Dependencies opnieuw installeren:

```powershell
cd C:\minecraft-ai-bots\minecraft-ai-bot-1
npm install
```

Poort bezet:

```powershell
$env:PORT="3050"
$env:VIEWER_PORT="3051"
node bot.js
```

Microsoft login faalt:

- Controleer of het account Minecraft Java bezit.
- Controleer of `MC_AUTH` op `microsoft` staat.
- Start de bot opnieuw en gebruik de login-link/code uit de terminal.

Offline/local server:

- Gebruik `MC_AUTH="offline"`.
- Gebruik een unieke username per bot.
- Zorg dat de server offline-mode toestaat.

## 9. Belangrijk Voor Multi-Bot

- Elke botmap heeft eigen `knowledge`, `worlds`, `memory` en settings.
- Start bots met unieke HUD/viewer poorten.
- Geef offline bots unieke usernames zoals `bot1`, `bot2`, `bot3`.
- Laat bots niet allemaal exact dezelfde taak doen op dezelfde plek, anders kunnen ze elkaar blokkeren.
