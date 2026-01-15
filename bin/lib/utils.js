import { homedir } from 'os';
import { resolve } from 'path';

/**
 * Resolve GT directory, expanding ~ to home directory
 */
export function resolveGtDir(gtDir) {
  if (!gtDir) {
    return resolve(homedir(), 'gt');
  }

  // Expand ~ to home directory
  if (gtDir.startsWith('~')) {
    return resolve(homedir(), gtDir.slice(2) || '');
  }

  return resolve(gtDir);
}

/**
 * Expand ~ in a path to the home directory
 */
export function expandHome(pathStr) {
  if (pathStr.startsWith('~')) {
    return resolve(homedir(), pathStr.slice(2) || '');
  }
  return pathStr;
}
