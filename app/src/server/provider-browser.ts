import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** Ask Windows to use the user's HTTPS handler. The URL is data, never a command. */
export function openProviderBrowser(address: string): Promise<void> {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Invalid sign-in address.');
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $address=$env:CAGE_PROVIDER_SIGN_IN; Remove-Item Env:CAGE_PROVIDER_SIGN_IN; Start-Process -FilePath $address"],
    { windowsHide: true, timeout: 15000, env: { ...process.env, CAGE_PROVIDER_SIGN_IN: url.href } },
    error => error ? reject(Error('Windows could not open the default browser.')) : resolve());
  });
}
