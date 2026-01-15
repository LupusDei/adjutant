import { execFileSync } from 'child_process';

/**
 * Check if ngrok is installed and available
 */
export async function checkNgrok() {
  try {
    // Use 'where' on Windows, 'which' on Unix
    const command = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(command, ['ngrok'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ngrok binary path
 */
export function getNgrokPath() {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(command, ['ngrok'], { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    return 'ngrok';
  }
}
