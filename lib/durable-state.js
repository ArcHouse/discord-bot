'use strict';
const MARKER = 'ZOHAN_STATE_V1';
const MAX_BYTES = 1024 * 1024;
function validate(value) {
    if (!value || value.version !== 1 || !value.settings || !value.xp || !value.scores || [value.settings, value.xp, value.scores].some(x => typeof x !== 'object' || Array.isArray(x))) throw new Error('STATE_INVALID');
    for (const [id, data] of Object.entries(value.xp)) {
        if (!/^\d{17,20}$/.test(id) || !data || !['xp', 'messages', 'lastLevel'].every(k => Number.isSafeInteger(data[k]) && data[k] >= 0)) throw new Error('STATE_XP_INVALID');
    }
    for (const [id, data] of Object.entries(value.scores)) {
        if (!/^\d{17,20}$/.test(id) || !data || !['wins', 'total'].every(k => Number.isSafeInteger(data[k]) && data[k] >= 0)) throw new Error('STATE_SCORES_INVALID');
    }
    for (const key of Object.keys(value.settings)) if (!['WELCOME_CHANNEL', 'AUTOROLE'].includes(key) || typeof value.settings[key] !== 'string' || value.settings[key].length > 100) throw new Error('STATE_SETTINGS_INVALID');
    return value;
}
function createDurableState({ client, env = process.env, snapshot, restore, fetcher = fetch, log = console }) {
    const status = { ready: false, lastSaved: null, lastError: null };
    let channel, timer, saving, dirty = false;
    async function load() {
        try {
            if (!/^\d{17,20}$/.test(env.STATE_CHANNEL_ID || '')) throw new Error('STATE_CHANNEL_REQUIRED');
            channel = await client.channels.fetch(env.STATE_CHANNEL_ID);
            if (!channel || channel.type !== 0 || channel.guildId !== env.SERVER_CONTROL_GUILD_ID) throw new Error('STATE_CHANNEL_INVALID');
            const everyone = channel.permissionOverwrites.cache.get(channel.guildId);
            if (!everyone?.deny.has(1024n)) throw new Error('STATE_CHANNEL_NOT_PRIVATE');
            const messages = await channel.messages.fetch({ limit: 20 });
            const records = [...messages.values()].filter(m => m.author.id === client.user.id && m.content === MARKER);
            if (messages.size === 20 && records.length === 0) throw new Error('STATE_HISTORY_INCOMPLETE');
            if (records.length) {
                // A corrupt newest snapshot must not silently roll back confirmed settings.
                const attachment = [...records[0].attachments.values()].find(a => a.name === 'state.json');
                if (!attachment || attachment.size > MAX_BYTES) throw new Error('STATE_ATTACHMENT_INVALID');
                const url = new URL(attachment.url);
                if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw new Error('STATE_ATTACHMENT_HOST');
                const response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(10000) });
                if (!response.ok) throw new Error('STATE_DOWNLOAD_FAILED');
                const text = await response.text();
                if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('STATE_TOO_LARGE');
                restore(validate(JSON.parse(text)));
                status.lastSaved = new Date(records[0].createdTimestamp).toISOString();
            }
            status.ready = true; status.lastError = null;
            if (!records.length) { dirty = true; await flush(); }
            log.log('[state] durable storage ready');
        } catch (error) { status.ready = false; status.lastError = error.message.startsWith('STATE_') ? error.message : error.name; log.error('[state] load failed code=' + status.lastError); }
    }
    function changed() {
        if (!status.ready) return;
        dirty = true;
        if (!timer) timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 10000);
    }
    async function flush() {
        if (!status.ready) throw new Error('STATE_NOT_READY');
        if (saving) { await saving; if (dirty) return flush(); return; }
        if (!dirty) return;
        saving = (async () => {
            dirty = false;
            try {
                const bytes = Buffer.from(JSON.stringify(validate(snapshot())));
                if (bytes.length > MAX_BYTES) throw new Error('STATE_TOO_LARGE');
                await channel.send({ content: MARKER, files: [{ attachment: bytes, name: 'state.json' }], allowedMentions: { parse: [] }, flags: 4096 });
                status.lastSaved = new Date().toISOString(); status.lastError = null;
                // Keep two recent snapshots. An ambiguous send is never deleted or blindly repeated here.
                const messages = await channel.messages.fetch({ limit: 20 });
                const old = [...messages.values()].filter(m => m.author.id === client.user.id && m.content === MARKER).slice(2);
                for (const message of old) await message.delete().catch(() => {});
            } catch (error) { dirty = true; status.lastError = error.message.startsWith('STATE_') ? error.message : error.name; log.error('[state] save failed code=' + status.lastError); throw error; }
        })();
        try { await saving; } finally { saving = null; }
    }
    return { status, load, changed, flush };
}
module.exports = { createDurableState, validate, MARKER };
