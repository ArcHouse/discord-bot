'use strict';

function isPrivate(channel, guild, botId, flags) {
    if (channel.type !== 0) return false;
    const overwrites = [...channel.permissionOverwrites.cache.values()];
    const everyone = overwrites.find(o => o.id === guild.id);
    if (!everyone?.deny.has(flags.ViewChannel)) return false;
    if (overwrites.some(o => o.allow.has(flags.ViewChannel) && ![guild.ownerId, botId].includes(o.id))) return false;
    const owner = channel.permissionsFor(guild.ownerId);
    const bot = channel.permissionsFor(botId);
    return !!owner?.has(flags.ViewChannel) && !!bot?.has([
        flags.ViewChannel, flags.SendMessages, flags.EmbedLinks, flags.ReadMessageHistory
    ]);
}

// Only the server owner can create/reuse this channel. Never loosen an existing channel's permissions.
async function prepareTestChannel(guild, actorId, botId, flags) {
    if (actorId !== guild.ownerId) throw new Error('Только владелец сервера может запускать этот тест.');
    await guild.channels.fetch();
    const candidates = [...guild.channels.cache.values()].filter(ch =>
        ch.name === 'zohan-news-test' || ch.name.includes('мой-для-тестов'));
    if (candidates.length > 1) throw new Error('Найдено несколько тестовых каналов. Оставьте один целевой канал для проверки.');
    let channel = candidates[0];
    if (!channel) {
        channel = await guild.channels.create({
            name: 'zohan-news-test', type: 0,
            reason: 'Private news test requested by server owner',
            permissionOverwrites: [
                { id: guild.id, deny: [flags.ViewChannel] },
                { id: guild.ownerId, allow: [flags.ViewChannel, flags.SendMessages, flags.ReadMessageHistory] },
                { id: botId, allow: [flags.ViewChannel, flags.SendMessages, flags.EmbedLinks, flags.ReadMessageHistory] }
            ]
        });
    }
    if (!isPrivate(channel, guild, botId, flags)) {
        throw new Error('Тестовый канал найден, но его права не подходят: нужен доступ только владельцу и боту. Права не изменены.');
    }
    return channel;
}

const pending = new Map();
function getTestChannel(guild, actorId, botId, flags) {
    if (actorId !== guild.ownerId) return Promise.reject(new Error('Только владелец сервера может запускать этот тест.'));
    if (pending.has(guild.id)) return pending.get(guild.id);
    const promise = prepareTestChannel(guild, actorId, botId, flags).finally(() => pending.delete(guild.id));
    pending.set(guild.id, promise);
    return promise;
}

module.exports = { isPrivate, getTestChannel };
