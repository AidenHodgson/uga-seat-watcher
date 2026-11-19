import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = path.join(ROOT, 'config.json');

/** Where the log and state live: %LOCALAPPDATA% on Windows, Application Support on a Mac. */
export const DATA = (() => {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'uga-seat-watcher');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'uga-seat-watcher');
  return path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'uga-seat-watcher');
})();
fs.mkdirSync(DATA, { recursive: true });

export const STATE = path.join(DATA, 'state.json');
export const LOG = path.join(DATA, 'watcher.log');

export const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

export function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n');
    if (fs.statSync(LOG).size > 1_000_000) fs.writeFileSync(LOG, fs.readFileSync(LOG, 'utf8').slice(-200_000));
  } catch {
    // logging must never stop a check
  }
}
