# Automatic updates

Installed Avi builds check the latest stable [GitHub release](https://github.com/aivaxlabs/avi/releases/latest) at startup and every six hours. Drafts and prereleases are not offered. Only a version newer than the running app is offered; an older public release never causes a downgrade.

## Install an update

1. An update indicator appears on **Settings** when a newer release is found.
2. Open **Settings → General**. The green update banner shows the available version.
3. Finish active work, then select **Install update**. Avi downloads the file matching its platform and architecture and shows download progress.
4. Avi closes when installation starts. The installer or update helper reopens Avi after replacing the application.

**Settings → About** always provides update status and a manual update check. General shows the update card only when a newer version is available. A failed check, download, verification, or installer handoff shows an error instead of closing Avi. Retry after resolving the reported problem. No GitHub account or token is required; GitHub's public API rate limits still apply.

## Platform requirements

- **Windows:** uses the NSIS `.exe` installer in silent mode with relaunch enabled. Windows may request elevation for an installation that requires it.
- **macOS:** uses the `.dmg` release asset to replace the installed `.app`, then opens it. Run Avi from a writable installation location, not directly from a mounted DMG. The update helper waits for Avi to exit before replacement.
- **Linux:** updates the running `.AppImage` identified by `APPIMAGE`, then launches the replacement. The AppImage and its containing directory must be writable. Other Linux installation formats are not supported by this updater.
- **Development builds and unsupported architectures:** in-app installation is unavailable; About explains why.

The updater supports x64 and ARM64. On an emulated installation it follows the architecture of the running Avi process. A successful installation handoff is not proof that the external installer completed: operating-system security policy, permissions, or a subsequent installer failure can still prevent relaunch. If Avi does not reopen, launch it manually and check its version; download the installer from GitHub if recovery is necessary. Post-shutdown helper errors are recorded in `debug.log` inside the system temporary directory under `.avi/visualizations/<timestamp>/app-update-<id>/`.

## Release publishing

`.github/workflows/build-desktop.yml` builds each platform and merges the installer artifacts into the flat **avi-release** Actions ZIP. Publish the **contents** of that ZIP as assets on a stable GitHub release in `aivaxlabs/avi`, not just the ZIP itself. Use a semantic version tag such as `v0.7.0` and ensure packaged `package.json` has the same version.

| Platform | Current Actions filename | Recognized legacy filename |
| --- | --- | --- |
| Windows | `Avi-windows-x64.exe`, `Avi-windows-arm64.exe` | `Avi-<version>-win-<arch>.exe` |
| macOS | `Avi-macos-x64.dmg`, `Avi-macos-arm64.dmg` | `Avi-<version>-mac-<arch>.dmg` |
| Linux | `Avi-linux-x64.AppImage` or `Avi-linux-x86_64.AppImage`, `Avi-linux-arm64.AppImage` | `Avi-<version>-linux-<arch>.AppImage` |

For Linux x64, both `x64` and electron-builder's `x86_64` spelling are recognized. `.blockmap`, YAML metadata, and ZIP wrappers are not installers. A newer release without the matching installer produces an error rather than selecting another platform's asset.

Downloads are restricted to the configured GitHub repository and GitHub's HTTPS release-asset hosts. Avi verifies the expected asset size and SHA-256 digest when GitHub supplies one before starting installation. Publish trusted release assets and keep repository release permissions restricted.

## Automation

Authenticated global RPC clients can inspect, check, and install updates using [Application updates RPC](api/rpc/updates.md). Installation is an explicit action; checking alone never downloads or runs an installer.
