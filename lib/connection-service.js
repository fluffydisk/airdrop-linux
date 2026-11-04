'use strict';
const https = require('node:https');
const { relayUrl, deviceId } = require('./relay-protocol');

// Enrollment exchanges a locally generated identity for a device-scoped token.
// The service's master key is never distributed to apps or their users.
function enrollDevice({ url, deviceKey, signal, transportOptions = {} }) {
  const endpoint = new URL('/v1/enroll', relayUrl(url));
  deviceId(deviceKey);
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, { ...transportOptions, method: 'POST', signal, agent: false,
      headers: { 'x-airdrop-device': deviceKey, 'content-length': '0' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 2048) response.destroy(Error('Invalid connection service response')); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw Error('Connection service is temporarily unavailable. Try again, or connect over the same Wi-Fi.');
          const value = JSON.parse(body);
          if (typeof value.accessKey !== 'string' || !/^device\.[a-f0-9]{64}$/.test(value.accessKey)) throw Error('The connection service could not register this computer. Please try again.');
          resolve(value.accessKey);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(10000, () => request.destroy(Error('Connection service did not respond. Check your internet connection and try again.')));
    request.on('error', reject); request.end();
  });
}
module.exports = { enrollDevice };
