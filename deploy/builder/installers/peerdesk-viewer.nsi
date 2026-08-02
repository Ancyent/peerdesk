; NSIS setup for the PeerDesk viewer, built with makensis on Linux.
; See peerdesk-viewer.wxs for why these definitions are ours rather than
; Tauri's, and for the WebView2 gap that applies here too. The experiment
; version produced a working 12,181,042-byte Nullsoft self-extracting archive;
; this adds the upgrade handling it left out.

!ifndef VERSION
  !error "VERSION must be passed: makensis -DVERSION=1.2.3"
!endif
!ifndef OUTFILE
  !error "OUTFILE must be passed: makensis -DOUTFILE=path.exe"
!endif

!define APPNAME "PeerDesk"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel admin
Unicode true

; LZMA brings the 53 MB binary down to roughly what the MSI achieves, so the
; two formats stay comparable rather than one looking better on size alone.
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  ; Replace an existing install rather than stacking a second copy beside it.
  ReadRegStr $0 HKLM "${UNINSTKEY}" "UninstallString"
  StrCmp $0 "" done
  ExecWait '"$0" /S _?=$INSTDIR'
  done:
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File "peerdesk-desktop.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\peerdesk-desktop.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; The entries Add/Remove Programs reads. Tauri writes these for us today;
  ; doing it by hand is part of what taking over the installer definition costs.
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher"       "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\peerdesk-desktop.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
SectionEnd
