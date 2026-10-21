#!/usr/bin/env node
'use strict';
const { getPaths } = require('../lib/paths');
const { record } = require('../lib/manage');
record(getPaths(), process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
