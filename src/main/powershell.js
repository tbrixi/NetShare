const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

function psQuote(arg) {
  return "'" + String(arg).replace(/'/g, "''") + "'";
}

function runDirect(scriptPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ stdout, stderr });
      }
    );
  });
}

// Elevated execution. `Start-Process -Verb RunAs` is incompatible with its own
// -RedirectStandardOutput / -RedirectStandardError parameters (PowerShell raises
// "Parameter set cannot be resolved" before the UAC prompt even shows), so the
// elevated child writes its own output to files via PS-level redirection with
// an explicit UTF-8 encoding; the spawning wrapper only needs to launch it.
function runElevated(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const outFile     = path.join(os.tmpdir(), `netshare-out-${stamp}.txt`);
    const errFile     = path.join(os.tmpdir(), `netshare-err-${stamp}.txt`);
    const innerFile   = path.join(os.tmpdir(), `netshare-inner-${stamp}.ps1`);
    const wrapperFile = path.join(os.tmpdir(), `netshare-wrap-${stamp}.ps1`);

    // PowerShell parameter switches (e.g. `-PublicName`) must reach the script
    // **unquoted** or they get bound as positional values. Only quote actual
    // value arguments.
    const isSwitch = (s) => typeof s === 'string' && /^-[A-Za-z][\w-]*$/.test(s);
    const argsString = args.map((a) => (isSwitch(a) ? a : psQuote(a))).join(' ');

    // Runs elevated. Captures stdout to outFile and any terminating error to
    // errFile, both UTF-8. Exit code reflects success.
    const inner = `$ErrorActionPreference = 'Stop'
try {
  & ${psQuote(scriptPath)} ${argsString} | Out-File -FilePath ${psQuote(outFile)} -Encoding utf8
  exit 0
} catch {
  $_.Exception.Message | Out-File -FilePath ${psQuote(errFile)} -Encoding utf8
  exit 1
}
`;
    fs.writeFileSync(innerFile, inner, 'utf8');

    // Runs unelevated. Triggers the UAC prompt and waits for the elevated
    // child to finish. If the user cancels UAC, Start-Process throws —
    // surface that as a clear error string.
    const wrapper = `try {
  $p = Start-Process -FilePath 'powershell.exe' ` +
    `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(innerFile)} ` +
    `-Verb RunAs -Wait -WindowStyle Hidden -PassThru -ErrorAction Stop
  exit $p.ExitCode
} catch {
  ('ELEVATION_FAILED: ' + $_.Exception.Message) | Out-File -FilePath ${psQuote(errFile)} -Encoding utf8
  exit 1
}
`;
    fs.writeFileSync(wrapperFile, wrapper, 'utf8');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperFile],
      { windowsHide: true },
      (err) => {
        // Strip UTF-8 BOM that `Out-File -Encoding utf8` writes on PS 5.1.
        const strip = (s) => s.replace(/^﻿/, '');
        const stdout = fs.existsSync(outFile) ? strip(fs.readFileSync(outFile, 'utf8')) : '';
        const stderr = fs.existsSync(errFile) ? strip(fs.readFileSync(errFile, 'utf8')) : '';
        try { fs.unlinkSync(wrapperFile); } catch {}
        try { fs.unlinkSync(innerFile); } catch {}
        try { fs.unlinkSync(outFile); } catch {}
        try { fs.unlinkSync(errFile); } catch {}
        if (err && !stdout) return reject(new Error(stderr.trim() || err.message));
        resolve({ stdout, stderr });
      }
    );
  });
}

function runScript(scriptPath, args = [], { elevate = false } = {}) {
  return elevate ? runElevated(scriptPath, args) : runDirect(scriptPath, args);
}

module.exports = { runScript };
