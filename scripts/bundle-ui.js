'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'ui/vendor'), { recursive: true });
fs.copyFileSync(require.resolve('jszip/dist/jszip.min.js'), path.join(root, 'ui/vendor/jszip.min.js'));
fs.copyFileSync(require.resolve('jszip/LICENSE.markdown'), path.join(root, 'ui/vendor/JSZip-LICENSE.markdown'));
