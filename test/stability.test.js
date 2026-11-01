const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { selectChannel } = require('../lib/news');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
function commands() {
    const commands = new Map();
    const start = source.indexOf("commands.set('clearnews', {");
    const end = source.indexOf('// --- ПОМОЩЬ ---', start);
    vm.runInNewContext(source.slice(start, end), { commands, selectChannel, Date,
        PermissionsBitField: { Flags: { Administrator: 8n } }, process: { env: { NEWS_CHANNEL_ID: 'news' } } });
    return commands;
}
function fixture() {
    const channel = { id: 'news', type: 0, name: 'игровые-новости' };
    const replies = [];
    const message = { member: { permissions: { has: () => true } }, client: { user: { id: 'bot' } },
        guild: { channels: { async fetch() {}, cache: new Map([['news', channel]]) } },
        async reply(text) { replies.push(text); } };
    return { message, channel, replies };
}
test('setupnews reuses selected channel without deleting, creating or publishing', async () => {
    const { message, replies } = fixture();
    await commands().get('setupnews').execute(message);
    assert.match(replies[0], /<#news>/);
});
test('clearnews preserves dedup history, other bots and messages too old to bulk delete', async () => {
    const { message, channel, replies } = fixture();
    const now = Date.now(), day = 86400000;
    const records = [
        { author: { id: 'bot' }, createdTimestamp: now - day },
        { author: { id: 'other' }, createdTimestamp: now - 4 * day },
        { author: { id: 'bot' }, createdTimestamp: now - 15 * day },
        { author: { id: 'bot' }, createdTimestamp: now - 4 * day }
    ];
    channel.messages = { async fetch() { return { filter(fn) { const chosen = records.filter(fn); chosen.size = chosen.length; return chosen; } }; } };
    channel.bulkDelete = async eligible => { assert.equal(eligible.length, 1); assert.equal(eligible[0], records[3]); return { size: 0 }; };
    await commands().get('clearnews').execute(message);
    assert.match(replies[0], /бота: 0/);
    channel.bulkDelete = async () => { throw new Error('missing permissions'); };
    await assert.rejects(commands().get('clearnews').execute(message), /missing permissions/);
});
test('command handler ignores private messages and works with default prefix', async () => {
    let listener, runs = 0;
    const start = source.indexOf("client.on('messageCreate', async (message) => {");
    const end = source.indexOf('// Приветствие новых участников', start);
    vm.runInNewContext(source.slice(start, end), { client: { on(event, fn) { listener = fn; } },
        commands: new Map([['serveraudit', { async execute() { runs++; } }]]), process: { env: {} }, console });
    await listener({ author: { bot: false }, content: '!serveraudit' });
    assert.equal(runs, 0);
    await listener({ author: { bot: false }, content: '!serveraudit', guild: {}, member: {} });
    assert.equal(runs, 1);
});
test('initialization registers once on clientReady so reconnect cannot duplicate timers', () => {
    const start = source.indexOf("client.once('clientReady'");
    const end = source.indexOf("client.on('messageCreate'", start);
    let event, initializers = 0;
    vm.runInNewContext(source.slice(start, end), { client: { once(name) { event = name; initializers++; } } });
    assert.equal(event, 'clientReady'); assert.equal(initializers, 1);
});
