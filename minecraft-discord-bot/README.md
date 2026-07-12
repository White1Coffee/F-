# Minecraft AI Discord Bridge

Deze Discord-bot koppelt je Discord-server aan de lokale Minecraft AI Bot Hub.

## Instellen

1. Vul `DISCORD_TOKEN=` in `.env` met je token uit Discord Developer Portal.
2. Zet in Discord Developer Portal bij je bot `Message Content Intent` aan.
3. Optioneel: vul `DISCORD_CHANNEL_ID=` met het kanaal waar Minecraft chat heen en terug mag.
4. Optioneel: vul `DISCORD_BOT_CHANNELS=` om per Discord-kanaal een eigen bot-chat te maken.
5. Optioneel: vul `DISCORD_SERVER_CHAT_CHANNELS=` om per Discord-kanaal serverchat te tonen.
6. Start eerst de Hub via `F:\Start.cmd`.
7. De bridge start automatisch mee met `F:\Start.cmd`. Alleen Discord starten kan met `F:\StartDiscord.cmd`.
8. Alleen Discord stoppen kan met `F:\StopDiscord.cmd`.

Deze bridge gebruikt geen extra npm packages. `node_modules` is dus niet nodig.
Status- en chatberichten worden als Discord embeds gestuurd met Minecraft head PNG's op basis van de username.

## Aparte bot-kanalen

Gebruik `DISCORD_BOT_CHANNELS` als je elk Discord-kanaal aan een eigen Mineflayer bot wilt koppelen.

Makkelijkste manier vanuit Discord:

!mc link bot1
!mc link official-bot
!mc info
!mc discord setup
!mc bots setup
!mc unlink
!mc server chat link bot1
!mc server chat link 192.168.2.77:25565
!mc server chat unlink
!mc java chat link
!mc java op link
!mc java setup
!mc java cmd list
!mc java chat unlink
!mc java op unlink

Voorbeeld:

DISCORD_BOT_CHANNELS=123456789012345678:bot1,234567890123456789:official-bot

Daarna geldt:

- `ai help` in kanaal `123456789012345678` gaat alleen naar `bot1`.
- `ai help` in kanaal `234567890123456789` gaat alleen naar `official-bot`.
- `!mc info` toont alle commands netjes per categorie: Discord commands, AI commands en bot commands.
- `!mc discord setup` maakt de categorieën `java chats` en `bots`, zet Java/serverchat-kanalen bij `java chats`, en zet alle botkanalen bij `bots`.
- `!mc bots setup` maakt automatisch een kanaal per bot met de in-game username als kanaalnaam, bijvoorbeeld `bot1`, `bot2`, `official-bot`.
- Botkanalen tonen alleen bot-eigen berichten, zoals AI-antwoorden en botmeldingen.
- Serverchat-kanalen tonen player/server chat die de gekozen bot ziet.
- `!mc link <botnaam>` schrijft de koppeling automatisch naar `.env`.
- `!mc server chat link <botnaam>` schrijft een aparte serverchat-koppeling naar `.env`.
- `!mc server chat link <server-ip[:poort]>` kiest automatisch een online bot op die server.
- Gewone tekst in een serverchat-kanaal wordt via de gekoppelde bot naar Minecraft chat gestuurd.
- Zonder `DISCORD_BOT_CHANNELS` blijft `DISCORD_CHANNEL_ID` werken als gedeeld chatkanaal.

## Minecraft Java server-kanalen

De map `F:\minecraft-java-server` kan ook direct via Discord worden gekoppeld, zonder mineflayer bot ertussen.

- `!mc java chat link`: koppelt het huidige Discord-kanaal aan de serverchat zonder operator access.
- `!mc java op link`: koppelt het huidige Discord-kanaal aan de serverchat met operator/console access.
- `!mc java setup`: maakt automatisch twee kanalen: `minecraft-java-chat` en `minecraft-java-operator`.
- `!mc java cmd list`: voert een consolecommand uit, alleen in een operator-kanaal.
- Gewone tekst in beide Java-kanalen wordt via de server-manager als serverchat gestuurd.
- Berichten die met `/` beginnen worden alleen in een operator-kanaal als consolecommand uitgevoerd.
- Instellingen worden opgeslagen in `DISCORD_JAVA_SERVER_CHAT_CHANNELS` en `DISCORD_JAVA_SERVER_OP_CHANNELS`.

## Directe bot commands

Alles wat in Discord begint met `ai` wordt direct naar alle online Minecraft bots gestuurd.

Voorbeelden:

ai status
ai follow
ai stop
ai auto mine
ai guard SpelerNaam
ai go to 100 64 100

Gericht naar een bot of groep sturen kan nog steeds met de bridge commands. Die gebruiken `!mc`, zodat ze niet botsen met de Minecraft AI commands:

!mc send official-bot ai status
!mc send group:Ungrouped ai stop

## Bot commands

Gebruik standaard prefix `ai`.

ai help
ai help <category>
ai inv
ai status
ai info
ai rejoin
ai follow
ai stop
ai gather <item> <amount>
ai explore
ai auto on/off/mine/farm/combat/movement/crafting/world/progression/general
ai viewer on/off
ai pickup items
ai storage
ai dump junk
ai sort
ai equip armor
ai combat learn
ai hitman <playername>
ai hitman stop
ai guard <playername>
ai guard ally <playername>
ai recipes
ai get stronger
ai pvp
ai craft <item>
ai go to <x> <y> <z>
ai bridge <length>
ai bridge speed <length>
ai bridge up <length>
ai set home
ai home
ai remember village
ai remember mine
ai memories
ai farm
ai harvest
ai replant
ai breed animals
ai cave
ai nearest cave
ai return cave
ai diamonds
ai iron
ai beat minecraft

## Rechten

Laat `DISCORD_ALLOWED_ROLE_IDS` en `DISCORD_ALLOWED_USER_IDS` leeg om iedereen commands te laten gebruiken.
Vul een of beide met Discord IDs, gescheiden door komma's, om toegang te beperken.
