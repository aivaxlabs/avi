; Versions up to 0.8.0 stored user plugins in $INSTDIR\plugins, which the old uninstaller deletes during
; an update. Copy them before uninstallOldVersion runs; Avi moves this copy to ~/.aivax/plugins on startup.
!macro customInit
  ${If} ${FileExists} "$INSTDIR\plugins\*.*"
    CreateDirectory "$PROFILE\.aivax\plugins-migration"
    CopyFiles /SILENT "$INSTDIR\plugins\*.*" "$PROFILE\.aivax\plugins-migration"
  ${EndIf}
!macroend
