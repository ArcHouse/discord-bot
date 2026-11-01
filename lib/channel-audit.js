'use strict';

const { timingSafeEqual } = require('node:crypto');
const REQUIRED = { ViewChannel: 1024n, SendMessages: 2048n, EmbedLinks: 16384n, ReadMessageHistory: 65536n };

function cronAuthorized(secret, authorization) {
    if (typeof secret !== 'string' || !secret.trim() || typeof authorization !== 'string') return false;
    const expected = Buffer.from('Bearer ' + secret);
    const actual = Buffer.from(authorization);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function excerpt(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    const prefix = text.slice(0, limit - 1);
    // Prefer a complete sentence, otherwise keep whole words and mark the omission.
    const sentence = [...prefix.matchAll(/[.!?…](?=\s)/g)].at(-1);
    if (sentence && sentence.index >= limit / 2) return prefix.slice(0, sentence.index + 1);
    const space = prefix.lastIndexOf(' ');
    return prefix.slice(0, space >= limit / 2 ? space : prefix.length).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

async function auditGuild(guild, actorId, botId, configuredId) {
    if (actorId !== guild.ownerId) throw new Error('OWNER_ONLY');
    await guild.channels.fetch();
    await guild.roles.fetch();
    const channels = [...guild.channels.cache.values()].filter(Boolean);
    const findings = [];
    const news = channels.filter(c => [0, 5].includes(c.type) && /igrovye|игровые-новости/i.test(c.name) && !/lol/i.test(c.name));
    if (news.length > 1) findings.push('Несколько каналов игровых новостей: ' + news.map(c => '<#' + c.id + '>').join(', ') + '. Проверьте, что выбран нужный.');
    const target = configuredId ? channels.find(c => c.id === configuredId) : news.length === 1 ? news[0] : null;
    if (!target || ![0, 5].includes(target.type)) findings.push('Не удалось однозначно определить канал рассылки. Проверьте NEWS_CHANNEL_ID.');
    else {
        const permissions = target.permissionsFor(botId);
        const missing = Object.entries(REQUIRED).filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
        if (missing.length) findings.push('В <#' + target.id + '> боту не хватает прав: ' + missing.join(', ') + '.');
    }
    const adminRoles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id && !r.managed && r.permissions.has(8n));
    if (adminRoles.length) findings.push('Ролей с полным доступом администратора: ' + adminRoles.length + '. Их участники видят и закрытые каналы; проверьте назначения ролей.');
    const tests = channels.filter(c => c.name === 'zohan-news-test' || c.name.includes('мой-для-тестов'));
    if (tests.length > 1) findings.push('Найдено несколько тестовых каналов — закрытый тест не сможет выбрать один.');
    for (const channel of tests) {
        const overwrites = [...channel.permissionOverwrites.cache.values()];
        const everyone = overwrites.find(o => o.id === guild.id);
        if (!everyone?.deny.has(1024n)) findings.push('Для <#' + channel.id + '> не установлен явный запрет просмотра @everyone.');
        if (overwrites.some(o => o.allow.has(1024n) && ![guild.ownerId, botId].includes(o.id))) findings.push('В <#' + channel.id + '> явно разрешён просмотр другим ролям или участникам.');
    }
    return { channelCount: channels.length, targetId: target?.id || null, findings };
}

module.exports = { cronAuthorized, excerpt, auditGuild };
