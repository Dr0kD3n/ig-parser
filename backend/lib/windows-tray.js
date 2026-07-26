'use strict';

const path = require('path');
const { spawn } = require('child_process');

const AUTOSTART_VALUE_NAME = 'IG Bot';

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createAutostartCommand() {
  const executable = process.execPath;
  const workingDirectory = process.pkg ? path.dirname(executable) : path.resolve(__dirname, '..');
  const argumentsList = process.pkg ? [] : [path.join(workingDirectory, 'server.js')];
  const argumentsClause = argumentsList.length
    ? ` -ArgumentList ${quotePowerShell(argumentsList.join('" "'))}`
    : '';
  const script =
    `Start-Process -FilePath ${quotePowerShell(executable)}` +
    argumentsClause +
    ` -WorkingDirectory ${quotePowerShell(workingDirectory)} -WindowStyle Hidden`;

  return `powershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand ${encodePowerShell(script)}`;
}

function createTrayScript() {
  return `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$runKeyPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$valueName = $env:IG_BOT_AUTOSTART_NAME
$launchCommand = $env:IG_BOT_AUTOSTART_COMMAND
$appUrl = $env:IG_BOT_URL
$iconPath = $env:IG_BOT_ICON_PATH

$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.Opacity = 0

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = 'IG Bot'
$tray.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Открыть IG Bot')
$autostartItem = $menu.Items.Add('Запускать с системой')
$autostartItem.CheckOnClick = $false
[void]$menu.Items.Add('-')
$exitItem = $menu.Items.Add('Полностью выключить')
$tray.ContextMenuStrip = $menu

function Test-Autostart {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($runKeyPath)
  if ($null -eq $key) { return $false }
  try { return $key.GetValue($valueName, '') -eq $launchCommand }
  finally { $key.Close() }
}

function Open-App {
  Start-Process $appUrl
}

$autostartItem.Checked = Test-Autostart
$openItem.add_Click({ Open-App })
$tray.add_MouseClick({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-App }
})
$autostartItem.add_Click({
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runKeyPath)
  try {
    if (Test-Autostart) {
      $key.DeleteValue($valueName, $false)
      $autostartItem.Checked = $false
    } else {
      $key.SetValue($valueName, $launchCommand, [Microsoft.Win32.RegistryValueKind]::String)
      $autostartItem.Checked = $true
    }
  } finally {
    $key.Close()
  }
})
$exitItem.add_Click({
  [Console]::Out.WriteLine('shutdown')
  [Console]::Out.Flush()
})

$form.add_FormClosed({
  $inputTimer.Stop()
  $inputTimer.Dispose()
  $tray.Visible = $false
  $tray.Dispose()
})
$form.add_Shown({ $form.Hide() })

$readTask = [Console]::In.ReadLineAsync()
$inputTimer = New-Object System.Windows.Forms.Timer
$inputTimer.Interval = 200
$inputTimer.add_Tick({
  if ($readTask.IsCompleted) {
    $line = $readTask.Result
    if ($null -eq $line -or $line -eq 'quit') { $form.Close() }
  }
})
$inputTimer.Start()

[System.Windows.Forms.Application]::Run($form)
`;
}

function startWindowsTray({ url, onShutdown, logger = console }) {
  if (process.platform !== 'win32' || process.env.NODE_ENV === 'test') return null;

  const tray = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encodePowerShell(createTrayScript()),
    ],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        IG_BOT_URL: url,
        IG_BOT_ICON_PATH: process.execPath,
        IG_BOT_AUTOSTART_NAME: AUTOSTART_VALUE_NAME,
        IG_BOT_AUTOSTART_COMMAND: createAutostartCommand(),
      },
    }
  );

  tray.stdout.setEncoding('utf8');
  tray.stdout.on('data', (chunk) => {
    if (chunk.split(/\r?\n/).some((line) => line.trim() === 'shutdown')) onShutdown();
  });
  tray.stderr.setEncoding('utf8');
  tray.stderr.on('data', (chunk) => logger.error(`[TRAY] ${chunk.trim()}`));
  tray.on('error', (error) => logger.error(`[TRAY] Не удалось запустить: ${error.message}`));

  return {
    stop() {
      if (tray.exitCode !== null || tray.killed) return;
      tray.stdin.end('quit\n');
      const forceStop = setTimeout(() => tray.kill(), 1500);
      forceStop.unref();
      tray.once('exit', () => clearTimeout(forceStop));
    },
  };
}

module.exports = { startWindowsTray };
