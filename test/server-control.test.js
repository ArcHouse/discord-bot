const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createControl, validatePlan } = require('../lib/server-control');
const guildId = '1269021960042446860', channelId = '1527064201812508695', roleId = '1527064201812508696', botId = '1527064201812508697';
const secret = 'a'.repeat(64);
const env = { SERVER_CONTROL_ENABLED: 'true', SERVER_CONTROL_GUILD_ID: guildId, SERVER_CONTROL_SECRET: secret };
function fixture() {
    let edits = 0, fetches = 0, clock = 1000;
    const channel = { id: channelId, guildId, name: 'news', type: 0, parentId: null, position: 0, topic: '', permissionOverwrites: { cache: new Map() }, permissionsFor: () => ({ bitfield: 1024n }),
        async edit(data) { edits++; return { id: channelId, ...data }; },
        async send(data) { edits++; assert.deepEqual(data.allowedMentions, { parse: [] }); return { id: 'message' }; },
        messages: { async fetch() { return new Map(); } } };
    const role = { id: roleId, name: 'member', editable: true, managed: false, position: 1, permissions: { bitfield: 1024n }, async edit() { edits++; return { id: roleId }; } };
    const guild = { id: guildId, name: 'ZOHAN', ownerId: 'owner', members: { me: { permissions: { bitfield: 8n, has: () => true } } },
        channels: { cache: new Map([[channelId, channel]]), async fetch() { fetches++; }, async create() { edits++; return { id: channelId }; } },
        roles: { cache: new Map([[roleId, role]]), async fetch() { fetches++; }, async create() { edits++; return { id: roleId }; } } };
    const client = { isReady: () => true, user: { id: botId }, guilds: { cache: new Map([[guildId, guild]]) }, rest: { async put() { edits++; } } };
    const control = createControl({ client, env: { ...env }, now: () => clock, logger: { log() {}, error() {} } });
    return { control, client, guild, channel, role, get edits() { return edits; }, get fetches() { return fetches; }, advance() { clock += 120001; } };
}
test('control is disabled by default and authenticates a strong key bound to one guild', () => {
    const { client } = fixture();
    assert.equal(createControl({ client, env: {} }).authorized('Bearer ' + secret), false);
    assert.equal(createControl({ client, env: { ...env, SERVER_CONTROL_SECRET: 'short' } }).authorized('Bearer short'), false);
    assert.equal(createControl({ client, env }).authorized('Bearer ' + secret), true);
    assert.equal(createControl({ client, env }).authorized('Bearer ' + 'b'.repeat(64)), false);
});
test('snapshot reads guild structure without writes and serializes permissions', async () => {
    const f = fixture();
    const snapshot = await f.control.run({ op: 'snapshot' });
    assert.equal(snapshot.guild.id, guildId); assert.equal(snapshot.channels[0].botPermissions, '1024');
    assert.equal(f.edits, 0);
});
test('prepare is read only; changes require a one-use expiring confirmation', async () => {
    const f = fixture();
    const preview = await f.control.run({ op: 'prepare', plan: { action: 'edit_channel', targetId: channelId, data: { topic: 'Rules' } } });
    assert.equal(f.edits, 0); assert.equal(preview.applied, false);
    await f.control.run({ op: 'apply', confirmation: preview.confirmation });
    assert.equal(f.edits, 1);
    await assert.rejects(f.control.run({ op: 'apply', confirmation: preview.confirmation }), /PLAN_EXPIRED/);
    const expired = await f.control.run({ op: 'prepare', plan: { action: 'edit_role', targetId: roleId, data: { name: 'Players' } } });
    f.advance(); await assert.rejects(f.control.run({ op: 'apply', confirmation: expired.confirmation }), /PLAN_EXPIRED/);
});
test('arbitrary actions, foreign targets, managed roles and unsupported properties are rejected', async () => {
    const f = fixture();
    assert.throws(() => validatePlan({ action: 'delete_channel', data: {} }), /UNKNOWN_ACTION/);
    assert.throws(() => validatePlan({ action: 'edit_channel', targetId: channelId, data: { permissionOverwrites: [] } }), /INVALID_FIELDS/);
    await assert.rejects(f.control.run({ op: 'prepare', plan: { action: 'edit_channel', targetId: '999999999999999999', data: { name: 'bad' } } }), /CHANNEL_UNAVAILABLE/);
    f.role.managed = true;
    await assert.rejects(f.control.run({ op: 'prepare', plan: { action: 'edit_role', targetId: roleId, data: { name: 'bad' } } }), /ROLE_NOT_EDITABLE/);
    assert.equal(f.edits, 0);
});
test('permissions cannot exceed bot capabilities; conflicting overwrites fail', async () => {
    const f = fixture(); f.guild.members.me.permissions.has = () => false;
    await assert.rejects(f.control.run({ op: 'prepare', plan: { action: 'create_role', data: { name: 'Admin', permissions: '8' } } }), /CANNOT_GRANT_PERMISSIONS/);
    assert.throws(() => validatePlan({ action: 'set_channel_permissions', targetId: channelId, data: { roleId, allow: '1024', deny: '1024' } }), /CONFLICTING_PERMISSIONS/);
});
test('sending messages requires preview and suppresses mentions', async () => {
    const f = fixture();
    const preview = await f.control.run({ op: 'prepare', plan: { action: 'send_message', targetId: channelId, data: { content: '@everyone test' } } });
    assert.equal(f.edits, 0);
    await f.control.run({ op: 'apply', confirmation: preview.confirmation }); assert.equal(f.edits, 1);
});
test('failed writes consume confirmation and are never silently retried', async () => {
    const f = fixture(); f.channel.edit = async () => { throw new Error('network'); };
    const preview = await f.control.run({ op: 'prepare', plan: { action: 'edit_channel', targetId: channelId, data: { topic: 'test' } } });
    await assert.rejects(f.control.run({ op: 'apply', confirmation: preview.confirmation }), /network/);
    await assert.rejects(f.control.run({ op: 'apply', confirmation: preview.confirmation }), /PLAN_EXPIRED/);
});
test('HTTP refuses unauthenticated access, wrong method, invalid JSON and oversized payloads', async t => {
    const f = fixture();
    const server = http.createServer(f.control.handle);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const url = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(url)).status, 401); assert.equal(f.fetches, 0);
    const headers = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { headers })).status, 405);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers, body: 'a'.repeat(17000) })).status, 413);
    const result = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ op: 'snapshot' }) });
    assert.equal(result.status, 200); assert.equal((await result.json()).result.guild.id, guildId);
});
