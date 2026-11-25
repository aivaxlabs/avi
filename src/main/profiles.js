import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const defaultProfile = Object.freeze({ id: 'default', name: 'Default', color: null, isDefault: true });
const profileIdPattern = /^[a-z0-9-]{1,40}$/;
const colorPattern = /^#[0-9a-f]{6}$/i;

const requestedProfileId = process.argv
  .find((argument) => argument.startsWith('--profile='))
  ?.slice('--profile='.length) || null;

export let activeProfile = listProfiles().find((profile) => profile.id === requestedProfileId) ?? defaultProfile;

function aviRoot() {
  return join(homedir(), '.aivax');
}

function readRegistry() {
  try {
    const parsed = JSON.parse(readFileSync(join(aviRoot(), 'profiles.json'), 'utf8'));
    return (Array.isArray(parsed?.profiles) ? parsed.profiles : [])
      .filter((profile) => profileIdPattern.test(profile?.id) && profile.id !== defaultProfile.id);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function writeRegistry(profiles) {
  const path = join(aviRoot(), 'profiles.json');
  mkdirSync(aviRoot(), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify({ profiles }, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}

function normalizeFields({ name, color } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 40) throw new Error('Enter a profile name with up to 40 characters.');
  if (typeof color !== 'string' || !colorPattern.test(color)) throw new Error('Choose a profile color.');
  return { name: trimmed, color: color.toLowerCase() };
}

export function profilePaths(profile = activeProfile) {
  const root = profile.isDefault ? aviRoot() : join(aviRoot(), 'profiles', profile.id);
  const temporary = profile.isDefault ? join(tmpdir(), '.avi') : join(tmpdir(), '.avi', 'profiles', profile.id);
  return {
    root,
    database: join(root, 'aivax.sqlite'),
    media: join(root, 'media'),
    archivedMedia: join(temporary, 'archived-media'),
    bots: join(root, 'bots'),
    chatBackgrounds: join(root, 'chat-backgrounds'),
    userData: join(root, 'user-data'),
    pid: join(root, 'avi.pid'),
  };
}

export function listProfiles() {
  return [defaultProfile, ...readRegistry().map((profile) => ({ ...profile, isDefault: false }))];
}

export function createProfile(fields) {
  const profile = { id: randomUUID().slice(0, 8), ...normalizeFields(fields), createdAt: new Date().toISOString() };
  writeRegistry([...readRegistry(), profile]);
  mkdirSync(profilePaths({ ...profile, isDefault: false }).root, { recursive: true });
  return { ...profile, isDefault: false };
}

export function updateProfile(id, fields) {
  const registry = readRegistry();
  const current = registry.find((profile) => profile.id === id);
  if (!current) throw new Error('This profile cannot be edited.');
  const updated = { ...current, ...normalizeFields(fields) };
  writeRegistry(registry.map((profile) => (profile.id === id ? updated : profile)));
  if (activeProfile.id === id) activeProfile = { ...updated, isDefault: false };
  return { ...updated, isDefault: false };
}

export function deleteProfile(id) {
  const profile = listProfiles().find((entry) => entry.id === id);
  if (!profile || profile.isDefault) throw new Error('The Default profile cannot be removed.');
  if (isProfileRunning(profile)) throw new Error(`Close Avi in the ${profile.name} profile before removing it.`);
  writeRegistry(readRegistry().filter((entry) => entry.id !== id));
  const paths = profilePaths(profile);
  rmSync(paths.root, { recursive: true, force: true });
  rmSync(join(paths.archivedMedia, '..'), { recursive: true, force: true });
  return profile;
}

export function isProfileRunning(profile) {
  if (profile.id === activeProfile.id) return true;
  try {
    const pid = Number(readFileSync(profilePaths(profile).pid, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function recordProfileInstance() {
  const { pid, root } = profilePaths();
  mkdirSync(root, { recursive: true });
  writeFileSync(pid, String(process.pid), 'utf8');
}

export function clearProfileInstance() {
  const { pid } = profilePaths();
  try {
    if (readFileSync(pid, 'utf8') === String(process.pid)) rmSync(pid, { force: true });
  } catch {
    // A missing or unreadable instance file needs no cleanup.
  }
}
