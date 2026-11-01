'use strict';
const { createHash } = require('node:crypto');
const FEED = 'https://feeds.soundcloud.com/users/soundcloud:users:158817/sounds.rss';
const PERMISSIONS = [1024n, 2048n, 16384n, 65536n];
function trackUrl(value) {
    try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || u.hostname !== 'soundcloud.com' || u.username || u.password || !/^\/archouse\/[^/]+\/?$/.test(u.pathname)) return null;
        if (u.searchParams.has('secret_token')) return null;
        return 'https://soundcloud.com' + u.pathname.replace(/\/$/, '');
    } catch { return null; }
}
function title(value) {
    return String(value || 'Новый трек').replace(/^ArcHouse\s*[-—:]\s*/i, '').replace(/[@*_`~<>#\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}
async function history(channel, botId) {
    if (!channel.permissionsFor(botId)?.has(PERMISSIONS)) throw new Error('SOUNDCLOUD_PERMISSIONS');
    const seen = new Set();
    let before;
    for (let page = 0; page < 10; page++) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        for (const m of messages.values()) {
            if (m.author.id !== botId) continue;
            const links = [...(m.content || '').matchAll(/https:\/\/soundcloud\.com\/[^\s<>]+/g)].map(x => x[0]);
            for (const e of m.embeds || []) links.push(e.url);
            for (const link of links) { const url = trackUrl(link); if (url) seen.add(url); }
        }
        if (messages.size < 100) return seen;
        before = [...messages.values()].at(-1).id;
    }
    throw new Error('SOUNDCLOUD_HISTORY_LIMIT');
}
function createSoundCloudSync({ client, parser, env = process.env, now = () => new Date(), log = console }) {
    const status = { enabled: env.SOUNDCLOUD_SYNC_ENABLED === 'true', lastAttempt: null, lastSent: null, lastResult: 'not_started', failures: 0 };
    let running;
    async function run() {
        if (!status.enabled) return;
        status.lastAttempt = now().toISOString();
        try {
            if (!/^\d{17,20}$/.test(env.SOUNDCLOUD_CHANNEL_ID || '')) throw new Error('SOUNDCLOUD_CHANNEL_INVALID');
            const channel = await client.channels.fetch(env.SOUNDCLOUD_CHANNEL_ID);
            if (!channel || channel.type !== 0 || channel.guildId !== env.SERVER_CONTROL_GUILD_ID) throw new Error('SOUNDCLOUD_CHANNEL_INVALID');
            const seen = await history(channel, client.user.id);
            const feed = await parser.parseURL(FEED);
            if (String(feed.link || '').replace(/\/$/, '') !== 'https://soundcloud.com/archouse') throw new Error('SOUNDCLOUD_FEED_INVALID');
            let sent = 0;
            for (const item of [...(feed.items || [])].reverse()) {
                const url = trackUrl(item.link);
                if (!url || seen.has(url)) continue;
                await channel.send({ content: '### ArcHouse — ' + title(item.title) + '\n' + url, allowedMentions: { parse: [] }, flags: 4096, nonce: createHash('sha256').update(channel.id + url).digest('hex').slice(0, 24), enforceNonce: true });
                seen.add(url); sent++;
                status.lastSent = now().toISOString();
                if (sent === 5) break;
            }
            status.lastResult = sent ? 'sent:' + sent : ((feed.items || []).length ? 'no_new_items' : 'feed_empty');
            status.failures = 0;
            log.log('[soundcloud] ' + status.lastResult);
        } catch (error) {
            status.lastResult = 'failed'; status.failures++;
            log.error('[soundcloud] failed code=' + (/^SOUNDCLOUD_/.test(error.message) ? error.message : (error.code || error.name)));
        }
    }
    return { status, tick() { if (!running) running = run().finally(() => { running = null; }); return running; } };
}
module.exports = { createSoundCloudSync, trackUrl, history, title };
