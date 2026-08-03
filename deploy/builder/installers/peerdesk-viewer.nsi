; NSIS setup for the PeerDesk viewer, built with makensis on Linux.
; See peerdesk-viewer.wxs for why these definitions are ours rather than
; Tauri's. This script carries its own WebView2 detection and install block
; below, mirroring the MSI's mechanism since the two formats share no
; tooling. Current builds land around 11.3 MB compressed.

!include LogicLib.nsh

!ifndef VERSION
  !error "VERSION must be passed: makensis -DVERSION=1.2.3"
!endif
!ifndef OUTFILE
  !error "OUTFILE must be passed: makensis -DOUTFILE=path.exe"
!endif
!ifndef PRODUCT_NAME
  !error "PRODUCT_NAME must be passed: makensis -DPRODUCT_NAME=..."
!endif
!ifndef BINARY_NAME
  !error "BINARY_NAME must be passed: makensis -DBINARY_NAME=..."
!endif

!define APPNAME "${PRODUCT_NAME}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
!define WV2KEY "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

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
  ; WebView2. Detection mirrors the MSI: look in all three places the
  ; runtime can be registered -- HKLM's 64-bit view, HKLM's 32-bit view,
  ; then HKCU -- and act only if none of them has it. The per-user view
  ; matters -- a runtime installed for the current user is invisible to an
  ; HKLM-only check, and we would install a second copy on top of a working
  ; one. SetRegView is reset to 32 (NSIS's default view) once detection is
  ; done, not left at 64: it persists for the rest of the process, and 64
  ; would split the ARP writes below from the 32-bit view .onInit and the
  ; separate uninstaller process both use, breaking upgrade and uninstall.
  ;
  ; The download itself uses PowerShell's Invoke-WebRequest, the same
  ; mechanism the MSI's custom action shells out to -- not NSISdl, NSIS's
  ; own downloader plugin, which links no TLS provider and cannot reach an
  ; https URL (the http fwlink 301s to one). The download and the
  ; bootstrapper run as two separate steps, each checked against its own
  ; exit code, so a download failure and a runtime-installer failure produce
  ; distinguishable messages -- the MSI's single combined PowerShell call
  ; cannot tell those apart. This whole block runs before SetOutPath/File:
  ; NSIS has no transactional rollback, so failing here, before anything is
  ; written, is what keeps a failed install from leaving an orphaned
  ; Program Files entry with no shortcut, no uninstaller and no Add/Remove
  ; Programs listing.
  ;
  ; powershell.exe is invoked by its full $SYSDIR path, not bare. With
  ; RequestExecutionLevel admin, CreateProcess's unqualified-name search
  ; order would check the directory setup.exe was launched from -- usually
  ; Downloads -- before system32; a powershell.exe planted there would run
  ; elevated. Running this block before SetOutPath (see above) means the
  ; CWD hasn't even moved to $INSTDIR yet, so the full path is load-bearing
  ; here, not belt-and-suspenders.
  SetRegView 64
  ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ${If} $0 == ""
    SetRegView 32
    ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${WV2KEY}" "pv"
  ${EndIf}
  SetRegView 32

  ${If} $0 == ""
    DetailPrint "WebView2 runtime not found - downloading"
    ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "$$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile '$TEMP\MicrosoftEdgeWebview2Setup.exe'"` $1
    ${If} $1 != 0
      Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
      Abort "Could not download the WebView2 runtime (powershell exit $1). ${APPNAME} cannot run without it."
    ${EndIf}
    ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install' $2
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    ${If} $2 != 0
      Abort "The WebView2 runtime installer failed (exit $2). ${APPNAME} cannot run without it."
    ${EndIf}
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "${BINARY_NAME}"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${BINARY_NAME}"
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
  Delete "$INSTDIR\${BINARY_NAME}"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
SectionEnd
