'use strict';

const { createHash } = require('node:crypto');
const MAX_AGE = 72 * 60 * 60 * 1000;
const NEWS_PERMISSIONS = [1n << 10n, 1n << 11n, 1n << 14n, 1n << 16n]; // View, Send, Embed, History

function httpUrl(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.hash = '';
        return url.href;
    } catch { return null; }
}

function selectChannel(channels, configuredId) {
    const candidates = [...channels.values()].filter(ch => [0, 5].includes(ch.type));
    if (configuredId) {
        const channel = candidates.find(ch => ch.id === configuredId);
        if (!channel) throw Object.assign(new Error('NEWS_CHANNEL_ID is absent or is not a text/announcement channel'), { code: 'NEWS_CHANNEL_INVALID' });
        return channel;
    }
    const matching = candidates.filter(ch => /igrovye|игровые-новости/i.test(ch.name) && !/lol/i.test(ch.name));
    if (matching.length !== 1) throw Object.assign(new Error(`Expected one news channel, found ${matching.length}; set NEWS_CHANNEL_ID`), { code: 'NEWS_CHANNEL_AMBIGUOUS' });
    return matching[0];
}

// Discord is the durable record: Render Free deletes local files on restart.
// Fail closed if the bounded history scan cannot cover the freshness window.
async function readHistory(channel, botId, now) {
    // Discord can return an empty list when ReadMessageHistory is missing.
    if (!channel.permissionsFor(botId)?.has(NEWS_PERMISSIONS)) {
        throw Object.assign(new Error('News requires ViewChannel, SendMessages, EmbedLinks and ReadMessageHistory'), { code: 'NEWS_PERMISSIONS' });
    }
    const seen = new Set();
    let before;
    for (let page = 0; page < 5; page++) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!messages.size) return seen;
        let oldest = Infinity;
        for (const message of messages.values()) {
            oldest = Math.min(oldest, message.createdTimestamp);
            if (message.author.id === botId) {
                for (const embed of message.embeds) {
                    const url = httpUrl(embed.url);
                    if (url) seen.add(url);
                }
            }
        }
        if (messages.size < 100 || oldest < now - MAX_AGE) return seen;
        before = messages.last().id;
    }
    throw new Error('News history exceeds 500 messages in 72h; use a dedicated channel');
}

function embedLength(embed) {
    return (embed.title || '').length + (embed.description || '').length +
        (embed.footer?.text || '').length + (embed.author?.name || '').length +
        (embed.fields || []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

function createPublisher({ botId, fetchNews, buildEmbed, now = Date.now, logger = console }) {
    const running = new Map();
    const status = { lastAttempt: null, lastSent: null, lastResult: 'not_run', failures: 0 };
    async function publish(channel) {
        status.lastAttempt = new Date(now()).toISOString();
        try {
            const seen = await readHistory(channel, botId(), now());
            const items = await fetchNews();
            const embeds = [];
            let length = 0;
            for (const item of items) {
                const link = httpUrl(item.link);
                const date = Date.parse(item.date);
                if (!link || !item.title || !Number.isFinite(date) || now() - date > MAX_AGE || date > now() + 300000 || seen.has(link)) continue;
                const embed = await buildEmbed({ ...item, link });
                const size = embedLength(embed);
                if (size > 6000 || length + size > 6000) continue;
                embeds.push(embed);
                length += size;
                seen.add(link); // Only this batch; never persist a failed send.
                if (embeds.length === 10) break;
            }
            if (!embeds.length) {
                status.lastResult = 'no_new_items';
                logger.log('[news] no new eligible items');
                return { sent: 0 };
            }
            const nonce = createHash('sha256').update(channel.id + embeds.map(e => e.url).join('|')).digest('hex').slice(0, 24);
            const message = await channel.send({ embeds, flags: 4096, allowedMentions: { parse: [] }, nonce, enforceNonce: true });
            status.lastSent = new Date(message.createdTimestamp || now()).toISOString();
            status.lastResult = 'sent';
            logger.log(`[news] sent=${embeds.length} channel=${channel.id} message=${message.id}`);
            return { sent: embeds.length, messageId: message.id };
        } catch (error) {
            status.lastResult = 'failed';
            status.failures++;
            // Avoid logging request URLs or translation keys from exception messages.
            logger.error(`[news] failed channel=${channel.id} code=${error.code || error.name || 'unknown'}`);
            throw error;
        }
    }
    return {
        status,
        publish(channel) {
            if (running.has(channel.id)) return running.get(channel.id);
            const promise = publish(channel).finally(() => running.delete(channel.id));
            running.set(channel.id, promise);
            return promise;
        }
    };
}

function scheduleSlot(date, timeZone = 'Europe/Moscow') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(p => [p.type, p.value]));
    const hour = Number(parts.hour);
    const slot = [8, 14, 20].filter(h => h <= hour).at(-1);
    // Latest slot today: one catch-up after waking, never a backlog of old slots.
    return slot === undefined ? null : `${parts.year}-${parts.month}-${parts.day}T${slot}`;
}

function createScheduler({ run, timeZone = 'Europe/Moscow', now = () => new Date(), logger = console }) {
    scheduleSlot(now(), timeZone); // Validate the timezone before starting a timer.
    let completed;
    let active = false;
    return async function tick() {
        const slot = scheduleSlot(now(), timeZone);
        if (!slot || slot === completed || active) return;
        active = true;
        try { await run(); completed = slot; }
        catch { logger.error('[news] scheduled run failed; retry on next tick'); }
        finally { active = false; }
    };
}

module.exports = { MAX_AGE, httpUrl, selectChannel, readHistory, embedLength, createPublisher, scheduleSlot, createScheduler };
