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
!macroend