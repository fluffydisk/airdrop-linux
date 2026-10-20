#!/usr/bin/env node
'use strict';
// XDG autostart fallback for desktops that do not activate graphical-session.target.
const { execFileSync } = require('node:child_process');
const { getPaths } = require('../lib/paths');
const fs = require('node:fs');
const paths = getPaths();
if (fs.existsSync(paths.env)) {
  try { execFileSync('/usr/bin/systemctl', ['--user', 'start', 'airdrop-session.service'], { stdio: 'ignore' }); }
  catch { process.exitCode = 1; }
}
