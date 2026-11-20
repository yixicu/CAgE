import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export async function pickStorageFolder(): Promise<string | null> {
  if (process.platform === 'win32') {
    const script = [
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Choose a Carnot storage folder'",
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      'try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) } } finally { $dialog.Dispose(); $owner.Dispose() }',
    ].join('; ');
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, encoding: 'utf8' });
    return stdout || null;
  }
  try {
    const result = process.platform === 'darwin'
      ? await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a Carnot storage folder")'])
      : await run('zenity', ['--file-selection', '--directory', '--title=Choose a Carnot storage folder']);
    return result.stdout.trimEnd() || null;
  } catch (error) {
    if ((error as {code?: number}).code === 1 && (process.platform !== 'darwin' || String(error).includes('-128'))) return null;
    throw error;
  }
}
