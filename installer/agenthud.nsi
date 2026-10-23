Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!ifndef VERSION
  !error "VERSION gerekli"
!endif
!ifndef APP_EXE
  !error "APP_EXE gerekli"
!endif
!ifndef APP_ICON
  !error "APP_ICON gerekli"
!endif
!ifndef SETUP_EXE
  !error "SETUP_EXE gerekli"
!endif

Name "AgentHUD"
OutFile "${SETUP_EXE}"
InstallDir "$LOCALAPPDATA\Programs\AgentHUD"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 16
ShowInstDetails show
ShowUninstDetails show
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1055 "ProductName" "AgentHUD"
VIAddVersionKey /LANG=1055 "FileDescription" "AgentHUD Kurulum"
VIAddVersionKey /LANG=1055 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "LegalCopyright" "Serhat Kochan"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\AgentHUD.exe"
!define MUI_FINISHPAGE_RUN_TEXT "AgentHUD'u aç"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

!macro CheckRunning
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\AgentHUD.Compact") p.r0'
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_OK|MB_ICONEXCLAMATION "AgentHUD açık. Önce adadaki × düğmesiyle uygulamayı kapat, sonra yeniden dene." /SD IDOK
    Abort
  ${EndIf}
!macroend

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "AgentHUD, 64 bit Windows 10 veya 11 gerektirir." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "AgentHUD, Windows 10 veya 11 gerektirir." /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
  !insertmacro CheckRunning
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  !insertmacro CheckRunning
FunctionEnd

Section "AgentHUD"
  SetOutPath "$INSTDIR"
  ClearErrors
  File /oname=AgentHUD.exe "${APP_EXE}"
  File /oname=icon.ico "${APP_ICON}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Kurulum dosyaları yazılamadı. Kurulum klasörünü ve izinlerini kontrol et." /SD IDOK
    Abort
  ${EndIf}
  CreateShortCut "$DESKTOP\AgentHUD.lnk" "$INSTDIR\AgentHUD.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL
  CreateShortCut "$SMPROGRAMS\AgentHUD.lnk" "$INSTDIR\AgentHUD.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Kısayol oluşturulamadı. AgentHUD'u kurulum klasöründen açabilirsin." /SD IDOK
  ${EndIf}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "DisplayName" "AgentHUD"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "Publisher" "Serhat Kochan"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "URLInfoAbout" "https://agenthud.serhatkochan.com/"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD" "EstimatedSize" 5300
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\AgentHUD.lnk"
  Delete "$SMPROGRAMS\AgentHUD.lnk"
  Delete "$INSTDIR\AgentHUD.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentHUD"
SectionEnd
