!macro NSIS_HOOK_POSTINSTALL
  ${If} $NoShortcutMode = 1
    StrCpy $NoShortcutMode 0
    Call CreateOrUpdateStartMenuShortcut
    StrCpy $NoShortcutMode 1
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\remove-carnot-environment.exe"' $0
  StrCmp $0 0 +3
  SetErrorLevel 1
  Abort
  Delete "$INSTDIR\payload\app\dist\web\basic-physics-map.mjs"
  Delete "$INSTDIR\node-path.txt"
  Delete "$INSTDIR\workspace-path.txt"
  Delete "$INSTDIR\carnot-0.2.5.ico"
!macroend
; Extract a complete program image for the public setup's transactional update.
; Quit before Tauri touches running processes, shortcuts or the registry.
!macro NSIS_HOOK_PREINSTALL
  ${GetOptions} $CMDLINE "/CARNOTSTAGE" $0
  ${IfNot} ${Errors}
    !searchparse "${MAINBINARYSRCPATH}" "" CARNOT_BUILD_ROOT "\shell\target\release\"
    ClearErrors
    SetOutPath "$INSTDIR\payload\app"
    File /r "${CARNOT_BUILD_ROOT}\out\payload\app\*.*"
    SetOutPath "$INSTDIR"
    File "${MAINBINARYSRCPATH}"
    File "${CARNOT_BUILD_ROOT}\out\remove-carnot-environment.exe"
    File /oname=carnot-desktop.ico "${CARNOT_BUILD_ROOT}\shell\icons\icon.ico"
    WriteUninstaller "$INSTDIR\uninstall.exe"
    ${If} ${Errors}
      SetErrorLevel 1
    ${Else}
      SetErrorLevel 0
    ${EndIf}
    Quit
  ${EndIf}
!macroend
