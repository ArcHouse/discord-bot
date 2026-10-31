'use strict';
// Optional preload: node --require ./lib/discord-diagnostics.js index.js
// Logs allowlisted status/rate-limit metadata only. No tokens, URLs or bodies.
const { Client } = require('discord.js');
const login = Client.prototype.login;
const safeCode = error => {
  const code = error?.code || error?.cause?.code;
  return typeof code === 'number' || ['ENOTFOUND','EAI_AGAIN','ECONNRESET','ETIMEDOUT','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT','TokenInvalid','DisallowedIntents'].includes(code) ? code : 'unclassified';
};

function numericHeader(headers, name) {
  const raw = headers?.get(name);
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function reportResponse(response) {
  const headers = response.headers;
  const rawScope = headers?.get('x-ratelimit-scope');
  const scope = ['user', 'global', 'shared'].includes(rawScope) ? rawScope : 'unknown';
  let retrySeconds = numericHeader(headers, 'retry-after');
  if (retrySeconds === null) {
    const rawDate = headers?.get('retry-after');
    const retryDate = rawDate ? Date.parse(rawDate) : NaN;
    if (Number.isFinite(retryDate)) retrySeconds = Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
  }
  const details = { status: response.status, scope,
    global: headers?.get('x-ratelimit-global') === 'true',
    retryAfterSeconds: retrySeconds,
    resetAfterSeconds: numericHeader(headers, 'x-ratelimit-reset-after'),
    remaining: numericHeader(headers, 'x-ratelimit-remaining') };
  console.log('[discord-health] response=' + JSON.stringify(details));
}

Client.prototype.login = function(token) {
  console.log('[discord-health] login_started token_configured=' + Boolean(token || this.token));
  this.on('error', error => console.error('[discord-health] client_error code=' + safeCode(error)));
  this.on('shardError', (error, shard) => console.error('[discord-health] shard_error shard=' + shard + ' code=' + safeCode(error)));
  this.on('shardDisconnect', (event, shard) => console.error('[discord-health] disconnected shard=' + shard + ' close_code=' + Number(event.code)));
  this.on('shardReady', shard => console.log('[discord-health] shard_ready shard=' + shard));
  this.rest.on('response', (_request, response) => reportResponse(response));
  this.rest.on('rateLimited', data => console.warn('[discord-health] rest_rate_limit global=' + Boolean(data.global) + ' retry_ms=' + Number(data.timeToReset || data.retryAfter || 0)));
  const timer = setInterval(() => console.log('[discord-health] ready=' + this.isReady() + ' ws_status=' + this.ws.status), 30000);
  timer.unref();
  this.once('clientReady', () => { clearInterval(timer); console.log('[discord-health] client_ready'); });
  // No extra gateway probe: rely on the client's existing requests and retry policy.
  return login.call(this, token).then(value => {
    console.log('[discord-health] login_completed'); return value;
  }, error => { clearInterval(timer); console.error('[discord-health] login_failed code=' + safeCode(error)); throw error; });
};
