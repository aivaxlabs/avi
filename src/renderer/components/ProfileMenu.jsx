import { ChevronRight, Pencil, Plus, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '../lib/format.js';
import { presetColors } from '../lib/palette.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { Overlay, Presence } from './Overlay.jsx';

export function ProfileAvatar({ color, size = 16 }) {
  return (
    <span
      className={classNames('profile-avatar', !color && 'neutral')}
      style={{ '--profile-avatar-size': `${size}px`, backgroundColor: color ?? undefined }}
      aria-hidden="true"
    >
      <UserRound size={Math.round(size * 0.66)} />
    </span>
  );
}

export function useProfiles() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.chatApp.profiles.list()
      .then((next) => { if (active) setState(next); })
      .catch((failure) => { if (active) setError(failure.message); });
    const unsubscribe = window.chatApp.profiles.onChanged(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return [state, setState, error];
}

export function ProfileDialog({ profile = null, onClose }) {
  const dialogRef = useRef(null);
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? presetColors[5].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current.showModal();
    return () => previous?.focus();
  }, []);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      if (await action()) onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Overlay as="dialog" ref={dialogRef} className="profile-dialog" aria-labelledby="profile-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        void run(async () => {
          await (profile
            ? window.chatApp.profiles.update({ id: profile.id, name, color })
            : window.chatApp.profiles.create({ name, color }));
          return true;
        });
      }}>
        <div className="dialog-header">
          <h2 id="profile-dialog-title">{profile ? 'Edit profile' : 'Add profile'}</h2>
          <button className="icon-button tiny" type="button" disabled={busy} onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="profile-dialog-body">
          <label>Name
            <input className="input" value={name} required maxLength={40} disabled={busy} autoFocus
              onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="profile-dialog-color">
            <span id="profile-dialog-color-label">Icon color</span>
            <div className="profile-dialog-colors" role="group" aria-labelledby="profile-dialog-color-label">
              <ProfileAvatar color={color} size={28} />
              {presetColors.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={classNames('color-swatch', color === option.value && 'active')}
                  style={{ backgroundColor: option.value }}
                  aria-label={option.name}
                  aria-pressed={color === option.value}
                  title={option.name}
                  disabled={busy}
                  onClick={() => setColor(option.value)}
                />
              ))}
            </div>
          </div>
          {profile?.running && (
            <p className="profile-dialog-note">Close Avi in this profile to remove it.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="profile-dialog-footer">
          {profile && (
            <button className="button danger" type="button" disabled={busy || profile.running}
              onClick={() => run(async () => {
                const next = await window.chatApp.profiles.remove(profile.id);
                return !next.profiles.some((entry) => entry.id === profile.id);
              })}>
              Remove
            </button>
          )}
          <button className="button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving...' : profile ? 'Save profile' : 'Add profile'}
          </button>
        </div>
      </form>
    </Overlay>,
    document.body,
  );
}

export function ProfileMenu() {
  const [state, setState] = useProfiles();
  const [menuPosition, setMenuPosition] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [dialogProfile, setDialogProfile] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const activeProfile = state?.profiles.find((profile) => profile.id === state.activeId);
  const editableProfiles = state?.profiles.filter((profile) => !profile.isDefault) ?? [];
  const label = activeProfile ? `Profile: ${activeProfile.name}` : 'Profiles';

  useEffect(() => {
    if (!menuPosition) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) {
        setMenuPosition(null);
      }
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setMenuPosition(null);
      buttonRef.current?.focus();
    }, { signal: controller.signal });
    queueMicrotask(() => menuRef.current?.querySelector('[role="menuitem"]:enabled')?.focus());
    return () => controller.abort();
  }, [menuPosition]);

  function toggleMenu() {
    if (menuPosition) {
      setMenuPosition(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({ left: rect.right + 8, bottom: Math.max(8, window.innerHeight - rect.bottom) });
    setEditOpen(false);
    window.chatApp.profiles.list().then(setState).catch(() => {});
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="activity-profile"
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuPosition)}
        onClick={toggleMenu}
      >
        <ProfileAvatar color={activeProfile?.color} size={24} />
      </button>
      <Presence when={menuPosition}>{(position) => createPortal(
        <DropdownMenu
          ref={menuRef}
          fixed
          className="profile-menu"
          role="menu"
          aria-label="Profiles"
          style={{ left: position.left, bottom: position.bottom }}
        >
          <div className="dropdown-menu-label">Profiles</div>
          {state?.profiles.map((profile) => {
            const current = profile.id === state.activeId;
            return (
              <DropdownMenuItem
                key={profile.id}
                role="menuitem"
                active={current}
                aria-current={current ? 'true' : undefined}
                icon={<ProfileAvatar color={profile.color} />}
                title={current ? 'Current profile' : profile.running ? 'Switch to its window' : 'Open in a new window'}
                onClick={() => {
                  setMenuPosition(null);
                  void window.chatApp.profiles.open(profile.id);
                }}
              >
                {profile.name}
                {(current || profile.running) && (
                  <small className="profile-menu-status">{current ? 'Current' : 'Open'}</small>
                )}
              </DropdownMenuItem>
            );
          })}
          <hr className="dropdown-menu-divider" />
          <DropdownMenuItem
            role="menuitem"
            icon={<Plus size={14} />}
            onClick={() => {
              setMenuPosition(null);
              setDialogProfile({});
            }}
          >
            Add profile
          </DropdownMenuItem>
          <div className="bot-submenu-holder">
            <DropdownMenuItem
              className="bot-submenu-trigger"
              role="menuitem"
              icon={<Pencil size={14} />}
              aria-haspopup="menu"
              aria-expanded={editOpen}
              disabled={editableProfiles.length === 0}
              title={editableProfiles.length === 0 ? 'The Default profile cannot be edited.' : undefined}
              onClick={() => setEditOpen((open) => !open)}
            >
              <>
                <span>Edit profile</span>
                <ChevronRight size={13} />
              </>
            </DropdownMenuItem>
            <Presence when={editOpen}>{() => (
              <DropdownMenu className="bot-submenu" submenu role="menu" aria-label="Edit profile">
                {editableProfiles.map((profile) => (
                  <DropdownMenuItem
                    key={profile.id}
                    role="menuitem"
                    icon={<ProfileAvatar color={profile.color} />}
                    onClick={() => {
                      setMenuPosition(null);
                      setDialogProfile(profile);
                    }}
                  >
                    {profile.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}</Presence>
          </div>
        </DropdownMenu>,
        document.body,
      )}</Presence>
      <Presence when={dialogProfile}>{(profile) => (
        <ProfileDialog profile={profile.id ? profile : null} onClose={() => setDialogProfile(null)} />
      )}</Presence>
    </>
  );
}
