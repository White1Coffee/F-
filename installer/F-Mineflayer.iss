#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceRoot
  #define SourceRoot "staging"
#endif
#ifndef OutputRoot
  #define OutputRoot "..\dist"
#endif

[Setup]
AppId={{C08DAB60-1352-4B87-A4F7-5AA44C9D380F}
AppName=F-Mineflayer
AppVersion={#AppVersion}
AppPublisher=White1Coffee
AppPublisherURL=https://github.com/White1Coffee/F-
DefaultDirName={localappdata}\Programs\F-Mineflayer
DefaultGroupName=F-Mineflayer
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputRoot}
OutputBaseFilename=F-Mineflayer-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UsePreviousAppDir=yes
UninstallDisplayIcon={app}\start.bat
CloseApplications=no
RestartApplications=no

[Types]
Name: "full"; Description: "Volledige installatie"

[Components]
Name: "core"; Description: "Core project, Hub, dashboard en official bot"; Types: full; Flags: fixed

[Tasks]
Name: "desktopicon"; Description: "Bureaubladsnelkoppelingen maken"; GroupDescription: "Snelkoppelingen:"; Flags: unchecked
Name: "startafter"; Description: "F-Mineflayer na installatie starten"; GroupDescription: "Afronden:"; Flags: unchecked

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\F-Mineflayer Start"; Filename: "{app}\start.bat"; WorkingDir: "{app}"
Name: "{group}\F-Mineflayer Stop"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{group}\F-Mineflayer Dashboard"; Filename: "http://localhost:3100/#overview"
Name: "{group}\F-Mineflayer Doctor"; Filename: "{app}\doctor.bat"; WorkingDir: "{app}"
Name: "{group}\F-Mineflayer Update"; Filename: "{app}\update.bat"; WorkingDir: "{app}"
Name: "{group}\F-Mineflayer Uninstall"; Filename: "{uninstallexe}"
Name: "{autodesktop}\F-Mineflayer Start"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autodesktop}\F-Mineflayer Dashboard"; Filename: "http://localhost:3100/#overview"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\setup.ps1"" -NonInteractive -InstallNode -MinecraftHost ""{code:GetMinecraftHost}"" -MinecraftPort {code:GetMinecraftPort} -MinecraftVersion ""{code:GetMinecraftVersion}"" -Auth ""{code:GetAuth}"" -BotCount {code:GetBotCount} -BotNamePrefix ""{code:GetBotPrefix}"" -HubPort {code:GetHubPort}"; WorkingDir: "{app}"; StatusMsg: "Node.js, configuratie en dependencies installeren..."; Flags: waituntilterminated
Filename: "{app}\start.bat"; Description: "F-Mineflayer starten"; Flags: postinstall nowait skipifsilent; Tasks: startafter

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\stop.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopF"

[Code]
var
  ServerPage, BotPage: TInputQueryWizardPage;
  OptionPage: TInputOptionWizardPage;

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectDir, 'Minecraft-server', 'Vul de servergegevens in.', 'Deze gegevens kunnen later in de Hub worden aangepast.');
  ServerPage.Add('Serveradres:', False); ServerPage.Values[0] := 'localhost';
  ServerPage.Add('Serverpoort:', False); ServerPage.Values[1] := '25565';
  ServerPage.Add('Minecraft-versie:', False); ServerPage.Values[2] := '1.21.4';
  ServerPage.Add('Hub/dashboardpoort:', False); ServerPage.Values[3] := '3100';
  BotPage := CreateInputQueryPage(ServerPage.ID, 'Bots', 'Configureer de gedeelde official-bot instances.', 'Iedere bot krijgt een unieke naam en poorten.');
  BotPage.Add('Aantal bots (1-32):', False); BotPage.Values[0] := '1';
  BotPage.Add('Botnaamprefix:', False); BotPage.Values[1] := 'Worker';
  OptionPage := CreateInputOptionPage(BotPage.ID, 'Authenticatie', 'Kies hoe bots aanmelden.', 'Microsoft vraagt bij de eerste start een browser/device-login; er wordt nooit een wachtwoord gevraagd.', True, False);
  OptionPage.Add('Offline'); OptionPage.Add('Microsoft'); OptionPage.SelectedValueIndex := 0;
end;

function ValidPort(const Value: String): Boolean;
var P: Integer;
begin P := StrToIntDef(Value, 0); Result := (P >= 1) and (P <= 65535); end;

function NextButtonClick(CurPageID: Integer): Boolean;
var C: Integer;
begin
  Result := True;
  if CurPageID = ServerPage.ID then begin
    if (Trim(ServerPage.Values[0]) = '') or not ValidPort(ServerPage.Values[1]) or not ValidPort(ServerPage.Values[3]) or (ServerPage.Values[1] = ServerPage.Values[3]) then begin MsgBox('Controleer host en unieke poorten (1-65535).', mbError, MB_OK); Result := False; end;
  end;
  if CurPageID = BotPage.ID then begin
    C := StrToIntDef(BotPage.Values[0], 0);
    if (C < 1) or (C > 32) or (Trim(BotPage.Values[1]) = '') then begin MsgBox('Gebruik 1-32 bots en een naam-prefix.', mbError, MB_OK); Result := False; end;
  end;
end;

function GetMinecraftHost(Param: String): String; begin Result := ServerPage.Values[0]; end;
function GetMinecraftPort(Param: String): String; begin Result := ServerPage.Values[1]; end;
function GetMinecraftVersion(Param: String): String; begin Result := ServerPage.Values[2]; end;
function GetHubPort(Param: String): String; begin Result := ServerPage.Values[3]; end;
function GetBotCount(Param: String): String; begin Result := BotPage.Values[0]; end;
function GetBotPrefix(Param: String): String; begin Result := BotPage.Values[1]; end;
function GetAuth(Param: String): String; begin if OptionPage.SelectedValueIndex = 1 then Result := 'microsoft' else Result := 'offline'; end;
