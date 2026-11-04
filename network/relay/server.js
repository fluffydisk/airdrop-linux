#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { createRelay } = require('../../lib/relay-server');
try {
  const relay = createRelay({
    domain: process.env.AIRDROP_RELAY_DOMAIN,
    accessKey: process.env.AIRDROP_RELAY_ACCESS_KEY,
    enrollment: process.env.AIRDROP_RELAY_ENROLLMENT === '1',
    tls: { cert: fs.readFileSync(process.env.AIRDROP_RELAY_CERT), key: fs.readFileSync(process.env.AIRDROP_RELAY_KEY) }
  });
  relay.server.listen(Number(process.env.PORT || 443), process.env.HOST || '0.0.0.0', () => console.log('Airdrop relay listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => relay.close().then(() => process.exit()));
} catch (error) { console.error('Could not start Airdrop relay:', error.message); process.exitCode = 1; }
