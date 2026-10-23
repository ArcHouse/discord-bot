'use strict';
// Optional preload: node --require ./lib/discord-diagnostics.js index.js
// Logs event names/status codes only. Never logs tokens, URLs or response bodies.
const { Client } = require('discord.js');
const login = Client.prototype.login;
const safeCode = error => {
  const code = error?.code || error?.cause?.code;
  return typeof code === 'number' || ['ENOTFOUND','EAI_AGAIN','ECONNRESET','ETIMEDOUT','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT','TokenInvalid','DisallowedIntents'].includes(code) ? code : 'unclassified';
};
Client.prototype.login = function(token) {
  console.log('[discord-health] login_started token_configured=' + Boolean(token || this.token));
  this.on('error', error => console.error('[discord-health] client_error code=' + safeCode(error)));
  this.on('shardError', (error, shard) => console.error('[discord-health] shard_error shard=' + shard + ' code=' + safeCode(error)));
  this.on('shardDisconnect', (event, shard) => console.error('[discord-health] disconnected shard=' + shard + ' close_code=' + Number(event.code)));
  this.on('shardReady', shard => console.log('[discord-health] shard_ready shard=' + shard));
  this.rest.on('response', (_request, response) => console.log('[discord-health] rest_http=' + response.status));
  this.rest.on('rateLimited', data => console.warn('[discord-health] rest_rate_limit global=' + Boolean(data.global) + ' retry_ms=' + Number(data.timeToReset || data.retryAfter || 0)));
  const timer = setInterval(() => console.log('[discord-health] ready=' + this.isReady() + ' ws_status=' + this.ws.status), 30000);
  timer.unref();
  this.once('clientReady', () => { clearInterval(timer); console.log('[discord-health] client_ready'); });
  fetch('https://discord.com/api/v10/gateway', { signal: AbortSignal.timeout(10000) })
    .then(response => console.log('[discord-health] public_gateway_http=' + response.status))
    .catch(error => console.error('[discord-health] public_gateway_error code=' + safeCode(error)));
  return login.call(this, token).then(value => {
    console.log('[discord-health] login_completed'); return value;
  }, error => { clearInterval(timer); console.error('[discord-health] login_failed code=' + safeCode(error)); throw error; });
};
