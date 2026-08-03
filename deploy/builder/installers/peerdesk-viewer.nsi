; NSIS setup for the PeerDesk viewer, built with makensis on Linux.
; See peerdesk-viewer.wxs for why these definitions are ours rather than
; Tauri's. This script carries its own WebView2 detection and install block
; below, mirroring the MSI's mechanism since the two formats share no
; tooling. The experiment version produced a working 12,181,042-byte
; Nullsoft self-extracting archive; this adds the upgrade handling it left
; out.

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
  SetOutPath "$INSTDIR"
  File "${BINARY_NAME}"

  ; WebView2. Same mechanism as the MSI and as the official installer: look in
  ; all three places the runtime can be registered, and download only if none of
  ; them has it. The per-user view matters -- a runtime installed for the
  ; current user is invisible to an HKLM-only check, and we would install a
  ; second copy on top of a working one.
  SetRegView 64
  ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ${If} $0 == ""
    SetRegView 32
    ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${WV2KEY}" "pv"
  ${EndIf}
  SetRegView 64

  ${If} $0 == ""
    DetailPrint "WebView2 runtime not found - downloading"
    NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    Pop $1
    ${If} $1 != "success"
      Abort "Could not download the WebView2 runtime ($1). ${APPNAME} cannot run without it."
    ${EndIf}
    ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install' $2
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    ${If} $2 != 0
      Abort "The WebView2 runtime installer failed (exit $2). ${APPNAME} cannot run without it."
    ${EndIf}
  ${EndIf}

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
