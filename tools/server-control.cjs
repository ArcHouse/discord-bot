'use strict';
// Use a local secret file, never put the access key in command-line arguments or chat.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const configFile = process.env.ZOHAN_CONTROL_CONFIG || path.join(__dirname, '..', '.local', 'server-control.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/admin/control') throw new Error('Invalid control endpoint');
    if (!/^[a-f0-9]{64}$/.test(config.secret || '')) throw new Error('Invalid local access key');
    const requestFile = process.argv[2];
    if (!requestFile) throw new Error('Provide a JSON request file (snapshot, messages, prepare or apply)');
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + config.secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(60000) });
    const result = await response.text();
    if (!response.ok) throw new Error('Control request failed: HTTP ' + response.status + ' ' + result.slice(0, 200));
    process.stdout.write(JSON.stringify(JSON.parse(result), null, 2) + '\n');
}
main().catch(error => { console.error(error.name === 'AbortError' || error.name === 'TimeoutError' ? 'Control request timed out; inspect server state before retrying any changes.' : error.message); process.exitCode = 1; });
