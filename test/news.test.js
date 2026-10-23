const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublisher, selectChannel, createScheduler, scheduleSlot, MAX_AGE, readHistory, embedLength } = require('../lib/news');
const { getTestChannel, isPrivate } = require('../lib/news-test-channel');
const now = Date.parse('2026-10-17T09:00:00Z');
const logger = { log() {}, error() {} };
const article = (id = 'one') => ({ title: id, link: 'https://example.com/' + id, date: new Date(now).toISOString() });
function collection(values) { const map = new Map(values.map(x => [x.id, x])); map.last = () => values.at(-1); return map; }
function channel(id = 'channel') {
    const history = [];
    let fail = false;
    return {
        id, history, payloads: [], type: 0, name: 'игровые-новости',
        permissionsFor() { return { has() { return true; } }; },
        messages: { async fetch() { return collection(history.slice().reverse()); } },
        set fail(value) { fail = value; },
        async send(payload) {
            if (fail) throw Object.assign(new Error('send failed'), { code: 50013 });
            this.payloads.push(payload);
            const message = { id: String(history.length + 1), author: { id: 'bot' }, createdTimestamp: now, embeds: payload.embeds };
            history.push(message);
            return message;
        }
    };
}
function publisher(items = [article()], overrides = {}) {
    return createPublisher({ botId: () => 'bot', now: () => now, logger,
        fetchNews: async () => items, buildEmbed: async item => ({ title: item.title, url: item.link, description: 'Description' }), ...overrides });
}

test('failed sends remain retryable and are not reported as success', async () => {
    const ch = channel(); const p = publisher(); ch.fail = true;
    await assert.rejects(p.publish(ch));
    assert.equal(p.status.lastSent, null); assert.equal(p.status.lastResult, 'failed');
    ch.fail = false;
    assert.equal((await p.publish(ch)).sent, 1);
    assert.equal(ch.payloads.length, 1);
});

test('Discord history prevents duplicates after process restart; test channel is independent', async () => {
    const production = channel('prod'); const sandbox = channel('test');
    await publisher().publish(sandbox);
    assert.equal((await publisher().publish(production)).sent, 1);
    assert.equal((await publisher().publish(production)).sent, 0);
    assert.equal(production.payloads.length, 1);
});

test('concurrent cron and scheduled runs coalesce into one send', async () => {
    const ch = channel(); const p = publisher();
    const a = p.publish(ch); const b = p.publish(ch);
    assert.equal(a, b);
    await Promise.all([a, b]); assert.equal(ch.payloads.length, 1);
});

test('ambiguous channel names fail safely; explicit ID resolves ambiguity', () => {
    const a = channel('a'); const b = channel('b'); const channels = collection([a, b]);
    assert.throws(() => selectChannel(channels), /found 2/);
    assert.equal(selectChannel(channels, 'b'), b);
    assert.throws(() => selectChannel(channels, 'missing'));
});

test('old, future, malformed, duplicate and unsafe RSS records are excluded', async () => {
    const ch = channel();
    const items = [article(), article(), { ...article('old'), date: new Date(now - MAX_AGE - 1).toISOString() },
        { ...article('future'), date: new Date(now + 900000).toISOString() },
        { ...article('invalid'), date: 'bad' }, { ...article('bad-url'), link: 'javascript:alert(1)' }];
    assert.equal((await publisher(items).publish(ch)).sent, 1);
});

test('history permission failure stops delivery rather than silently treating history as empty', async () => {
    const ch = channel(); ch.messages.fetch = async () => { throw new Error('Missing Access'); };
    await assert.rejects(publisher().publish(ch)); assert.equal(ch.payloads.length, 0);
});

test('missing ReadMessageHistory never masquerades as empty history', async () => {
    const ch = channel(); ch.permissionsFor = () => ({ has: () => false });
    await assert.rejects(publisher().publish(ch), /ReadMessageHistory/);
    assert.equal(ch.payloads.length, 0);
});

test('history pagination is bounded and fails safely on a busy channel', async () => {
    const ch = channel(); let reads = 0;
    ch.messages.fetch = async () => { reads++; return collection(Array.from({ length: 100 }, (_, i) => ({ id: String(i), author: { id: 'other' }, createdTimestamp: now, embeds: [] }))); };
    await assert.rejects(readHistory(ch, 'bot', now), /exceeds 500/);
    assert.equal(reads, 5);
});

test('combined embeds respect Discord 6000-character and 10-card limits', async () => {
    const ch = channel();
    await publisher(Array.from({ length: 20 }, (_, i) => article(String(i))), {
        buildEmbed: async item => ({ title: item.title, description: 'x'.repeat(750), url: item.link })
    }).publish(ch);
    const embeds = ch.payloads[0].embeds;
    assert.ok(embeds.length <= 10); assert.ok(embeds.reduce((sum, e) => sum + embedLength(e), 0) <= 6000);
    assert.deepEqual(ch.payloads[0].allowedMentions, { parse: [] });
    assert.equal(ch.payloads[0].enforceNonce, true);
});

test('RSS failure is observable and successful retry remains possible', async () => {
    const ch = channel(); let broken = true;
    const p = publisher([], { fetchNews: async () => { if (broken) throw new Error('All feeds failed'); return [article()]; } });
    await assert.rejects(p.publish(ch)); assert.equal(p.status.failures, 1);
    broken = false; assert.equal((await p.publish(ch)).sent, 1);
});

test('schedule uses Moscow timezone, catches up after wake, and runs once per slot', async () => {
    assert.equal(scheduleSlot(new Date('2026-10-17T05:00:00Z')), '2026-10-17T8');
    assert.equal(scheduleSlot(new Date('2026-10-17T04:59:00Z')), null);
    let date = new Date('2026-10-17T06:23:00Z'); let runs = 0;
    const tick = createScheduler({ now: () => date, run: async () => { runs++; }, logger });
    await tick(); await tick(); assert.equal(runs, 1);
    date = new Date('2026-10-17T12:15:00Z'); await tick(); assert.equal(runs, 2);
    assert.throws(() => createScheduler({ run() {}, timeZone: 'INVALID' }), RangeError);
});

test('failed scheduled run retries within the same slot', async () => {
    let runs = 0;
    const tick = createScheduler({ now: () => new Date(now), run: async () => { if (++runs === 1) throw Error('failed'); }, logger });
    await tick(); await tick(); await tick(); assert.equal(runs, 2);
});

const flags = { ViewChannel: 1n, SendMessages: 2n, EmbedLinks: 4n, ReadMessageHistory: 8n };
function permissions(bits) { return { has(value) { return (Array.isArray(value) ? value : [value]).every(bit => (bits & bit) === bit); } }; }
function privateChannel() {
    return { id: 'sandbox', type: 0, name: '🚩мой-для-тестов',
        permissionOverwrites: { cache: collection([{ id: 'guild', deny: permissions(1n), allow: permissions(0n) }]) },
        permissionsFor() { return permissions(15n); } };
}
test('only server owner can create or reuse a test channel', async () => {
    let fetches = 0;
    const guild = { id: 'guild', ownerId: 'owner', channels: { async fetch() { fetches++; } } };
    await assert.rejects(getTestChannel(guild, 'admin', 'bot', flags), /владелец/);
    assert.equal(fetches, 0);
});
test('existing private test channel is reused without changing permissions or creating a duplicate', async () => {
    const ch = privateChannel(); let creates = 0;
    const guild = { id: 'guild', ownerId: 'owner', channels: { cache: collection([ch]), async fetch() {}, async create() { creates++; } } };
    assert.equal(await getTestChannel(guild, 'owner', 'bot', flags), ch); assert.equal(creates, 0);
    ch.permissionOverwrites.cache.set('role', { id: 'role', allow: permissions(1n), deny: permissions(0n) });
    assert.equal(isPrivate(ch, guild, 'bot', flags), false);
    await assert.rejects(getTestChannel(guild, 'owner', 'bot', flags), /права/);
    assert.equal(creates, 0);
});

test('concurrent owner commands create one private channel with only owner and bot grants', async () => {
    let creates = 0; let options;
    const guild = { id: 'new-guild', ownerId: 'owner', channels: {
        cache: collection([]), async fetch() {}, async create(value) {
            creates++; options = value;
            const ch = privateChannel();
            ch.permissionOverwrites.cache = collection([{ id: 'new-guild', deny: permissions(1n), allow: permissions(0n) }]);
            return ch;
        }
    } };
    const [a, b] = await Promise.all([getTestChannel(guild, 'owner', 'bot', flags), getTestChannel(guild, 'owner', 'bot', flags)]);
    assert.equal(a, b); assert.equal(creates, 1);
    assert.equal(options.parent, undefined);
    assert.deepEqual(options.permissionOverwrites.map(o => o.id), ['new-guild', 'owner', 'bot']);
    assert.deepEqual(options.permissionOverwrites[0].deny, [flags.ViewChannel]);
});
