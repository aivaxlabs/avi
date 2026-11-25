# Profiles

A profile is a separate Avi: its own conversations, settings, providers and credentials, bots, scheduled jobs, Secret Vault, media, chat background, and trace log. Each profile can run in its own window at the same time as the others, one instance per profile.

## Switch and manage profiles

The profile icon sits above **Settings** in the Activity Bar. Select it to see every profile:

- Select a profile to open it in a new window, or to bring its window forward when it is already open. **Current** marks the profile of this window and **Open** marks profiles running in another window.
- **Add profile** asks for a name and an icon color.
- **Edit profile** lists the profiles you created; choose one to rename it, change its color, or **Remove** it. Removing permanently deletes the profile's data after a confirmation. A profile must be closed before it can be removed. The **Default** profile cannot be renamed or removed.

## Identify the profile in use

Windows other than the Default profile are titled `Avi - <profile name>`, and the profile icon (a user silhouette on the chosen color) marks the app:

- **Windows**: each profile has its own taskbar button with the profile icon as a badge, and the tray icon carries the same badge.
- **macOS**: the Dock and menu bar icons carry the badge.
- **Linux**: the window and tray icons carry the badge.

## Import and export

**Settings → Profiles** exports any profile to an `.aviprofile` file and imports one as a new profile; an import never replaces an existing profile, and a name that is already taken gets `(imported)` appended.

Exports include conversations, settings, bots in their default folders, media, and the chat background. They do not include provider credentials, Remote control API keys, MCP OAuth sessions, the AIVAX sign-in, or the Secret Vault, because those are encrypted for the current device; sign in and add them again after importing. A profile must have been opened at least once before it can be exported. Bots with a custom working folder keep pointing at that folder.

## Storage

The Default profile keeps using `~/.aivax`. Other profiles live in `~/.aivax/profiles/<id>`, and the list of profiles is stored in `~/.aivax/profiles.json`. Archived media of a non-default profile goes to `<temp>/.avi/profiles/<id>/archived-media`.

Installed plugins, workspaces, global context in `~/.agents`, and folder context are shared by every profile. Which built-in plugins are enabled is stored per profile.

To start a profile directly, run Avi with `--profile=<id>`. **Start Avi on logon** in **Settings → General** applies to the profile where it is enabled; on macOS only the Default profile can open at login.

Remote control listens on one port per instance. When several profiles run at the same time, give each one a different port in **Settings → Remote control**. `rpc:discover` reports the instance's profile; see [RPC overview](api/rpc/overview.md).
