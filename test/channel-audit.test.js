const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cronAuthorized, excerpt, auditGuild } = require('../lib/channel-audit');
const fs = require('node:fs');
const vm = require('node:vm');

test('installed command rejects non-owner and delivers report privately without server mutations', async () => {
    const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
    const start = source.indexOf("commands.set('serveraudit'");
    const end = source.indexOf('// --- МОДЕРАЦИЯ ---', start);
    const commands = new Map();
    let audits = 0, reports = 0, replies = 0;
    vm.runInNewContext(source.slice(start, end), { commands, Buffer, process: { env: {} }, client: { user: { id: 'bot' } }, console,
        async auditGuild() { audits++; return { channelCount: 3, targetId: 'news', findings: [] }; } });
    const message = { guild: { ownerId: 'owner' }, author: { id: 'visitor', async send(payload) {
        assert.equal(payload.files[0].name, 'server-audit.txt'); reports++;
    } }, async reply() { replies++; } };
    await commands.get('serveraudit').execute(message);
    assert.equal(audits, 0); assert.equal(reports, 0);
    message.author.id = 'owner';
    await commands.get('serveraudit').execute(message);
    assert.equal(audits, 1); assert.equal(reports, 1); assert.equal(replies, 1);
});

test('publication fails closed without a secret and rejects incorrect credentials', () => {
    for (const secret of [undefined, '', '   ']) assert.equal(cronAuthorized(secret, undefined), false);
    assert.equal(cronAuthorized('private-key', 'Bearer private-key'), true);
    assert.equal(cronAuthorized('private-key', 'Bearer wrong'), false);
    assert.equal(cronAuthorized('private-key', 'Bearer private-kez'), false);
});

test('news excerpt preserves words or sentences within Discord limits', () => {
    assert.equal(excerpt('Короткая новость', 30), 'Короткая новость');
    assert.equal(excerpt('Новая игра вышла. Подробности обновления и другие сведения.', 30), 'Новая игра вышла.');
    assert.equal(excerpt('Очень длинное описание новой интересной игры', 25), 'Очень длинное описание…');
    assert.ok(excerpt('а'.repeat(700)).length <= 500);
});

test('audit checks owner before accessing server and never changes channel settings', async () => {
    let reads = 0;
    const channel = { id: 'news', name: 'игровые-новости', type: 0, permissionsFor: () => ({ has: flag => flag !== 16384n }) };
    const guild = { id: 'guild', ownerId: 'owner',
        channels: { async fetch() { reads++; }, cache: new Map([['news', channel], ['other', { ...channel, id: 'other' }]]) },
        roles: { async fetch() { reads++; }, cache: new Map() } };
    await assert.rejects(auditGuild(guild, 'visitor', 'bot', 'news'), /OWNER_ONLY/);
    assert.equal(reads, 0);
    const result = await auditGuild(guild, 'owner', 'bot', 'news');
    assert.equal(reads, 2);
    assert.equal(result.targetId, 'news');
    assert.ok(result.findings.some(f => f.includes('EmbedLinks')));
    assert.ok(result.findings.some(f => f.includes('Несколько каналов')));
});
