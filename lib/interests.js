'use strict';
const TITLE = 'Что тебе интересно в ZOHAN?';
const GAMES = '1526414886756679732';
const LFG_MESSAGE = '1566508058060783668';
const DEFAULTS = ['1526414882231156878', '1526414883166486608', '1269021960042446862', '1526414885783863317', GAMES, '1526414888543457392', '1526414889285980182'];
function newIds(now = Date.now()) {
    let value = (BigInt(now) - 1420070400000n) << 22n;
    return () => String(value++);
}
function cleanPrompt(prompt) {
    return { id: prompt.id, title: prompt.title, type: prompt.type, single_select: prompt.single_select, required: prompt.required, in_onboarding: prompt.in_onboarding,
        options: prompt.options.map(o => ({ id: o.id, title: o.title, description: o.description || '', role_ids: o.role_ids || [], channel_ids: o.channel_ids || [], ...((o.emoji?.id || o.emoji_id) ? { emoji_id: o.emoji?.id || o.emoji_id } : (o.emoji?.name || o.emoji_name) ? { emoji_name: o.emoji?.name || o.emoji_name } : {}) })) };
}
function buildOnboarding(current, roles, guild, nextId = newIds()) {
    const previous = current.prompts.find(p => p.title === TITLE);
    const options = [
        { title: 'Игры и напарники', description: 'Обсуждение игр, поиск команды и игровой голосовой канал.', role_ids: [roles.games], channel_ids: [GAMES, '1526414892364730468'], emoji_name: '🎮' },
        { title: 'Музыка ArcHouse', description: 'Каталог, обсуждение и уведомления о новых треках. Подписку можно отключить.', role_ids: [roles.music], channel_ids: ['1566414392407490642', '1566414400837910679', '1566414409276985384'], emoji_name: '🎵' },
        { title: 'Игровые новости', description: 'Новости на русском со ссылками на источники.', role_ids: [roles.news], channel_ids: ['1527064201812508695'], emoji_name: '📰' }
    ].map(o => ({ ...o, id: previous?.options.find(old => old.title === o.title)?.id || nextId() }));
    for (const id of Object.values(roles)) {
        const role = guild.roles.cache.get(id);
        if (!role || role.managed || role.permissions.bitfield !== 0n || !role.editable) throw new Error('INTEREST_ROLE_UNSAFE');
    }
    const defaultIds = [...new Set([...current.default_channel_ids, ...DEFAULTS])];
    const allChannels = [...defaultIds, ...options.flatMap(o => o.channel_ids)];
    for (const id of allChannels) {
        const ch = guild.channels.cache.get(id);
        if (!ch || ![0, 2, 5].includes(ch.type) || !ch.permissionsFor(guild.roles.everyone)?.has(1024n)) throw new Error('ONBOARDING_CHANNEL_NOT_PUBLIC');
    }
    if (defaultIds.length < 7 || defaultIds.filter(id => guild.channels.cache.get(id).permissionsFor(guild.roles.everyone).has(3072n)).length < 5) throw new Error('ONBOARDING_DEFAULTS_INVALID');
    return { enabled: true, mode: current.mode ?? 0, default_channel_ids: defaultIds,
        prompts: [...current.prompts.filter(p => p.title !== TITLE).map(cleanPrompt), { id: previous?.id || nextId(), title: TITLE, type: 0, single_select: false, required: false, in_onboarding: true, options }] };
}
function sameConfiguration(current, desired) {
    const normalize = value => ({ enabled: value.enabled, mode: value.mode, default_channel_ids: [...value.default_channel_ids].sort(), prompts: value.prompts.map(cleanPrompt) });
    return JSON.stringify(normalize(current)) === JSON.stringify(normalize(desired));
}
async function installInterests({ client, env = process.env, log = console }) {
    const status = { lfgPinned: false, onboardingEnabled: false, lastError: null };
    try {
        const guild = await client.guilds.fetch(env.SERVER_CONTROL_GUILD_ID);
        const games = await client.channels.fetch(GAMES);
        const message = await games.messages.fetch(LFG_MESSAGE);
        if (message.author.id !== client.user.id) throw new Error('LFG_MESSAGE_NOT_OWN');
        if (!message.pinned) await message.pin('Server owner requested a teammate search template');
        status.lfgPinned = true;
        if (env.COMMUNITY_INTERESTS_ENABLED !== 'true') return status;
        await guild.channels.fetch(); await guild.roles.fetch();
        const route = '/guilds/' + guild.id + '/onboarding';
        const current = await client.rest.get(route);
        const roles = { music: env.MUSIC_LISTENER_ROLE_ID };
        for (const [key, name] of [['games', 'Интерес: игры'], ['news', 'Интерес: новости']]) {
            const matches = [...guild.roles.cache.values()].filter(r => r.name === name);
            if (matches.length > 1) throw new Error('INTEREST_ROLE_AMBIGUOUS');
            const role = matches[0] || await guild.roles.create({ name, permissions: 0n, mentionable: false, reason: 'Optional interests chosen by server members' });
            roles[key] = role.id;
        }
        const desired = buildOnboarding(current, roles, guild);
        if (!sameConfiguration(current, desired)) {
            const storage = await client.channels.fetch(env.STATE_CHANNEL_ID);
            if (!storage.permissionOverwrites.cache.get(guild.id)?.deny.has(1024n)) throw new Error('ONBOARDING_BACKUP_NOT_PRIVATE');
            const snapshots = await storage.messages.fetch({ limit: 20 });
            if (![...snapshots.values()].some(m => m.author.id === client.user.id && m.content === 'ZOHAN_ONBOARDING_BACKUP_V1')) {
                const backup = { onboarding: current, guild: { features: guild.features, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, defaultMessageNotifications: guild.defaultMessageNotifications, rulesChannelId: guild.rulesChannelId, publicUpdatesChannelId: guild.publicUpdatesChannelId } };
                await storage.send({ content: 'ZOHAN_ONBOARDING_BACKUP_V1', files: [{ attachment: Buffer.from(JSON.stringify(backup)), name: 'onboarding-before.json' }], flags: 4096, allowedMentions: { parse: [] } });
            }
        }
        if (!guild.features.includes('COMMUNITY')) {
            await guild.edit({ features: [...guild.features, 'COMMUNITY'], verificationLevel: Math.max(guild.verificationLevel, 1), explicitContentFilter: 2,
                defaultMessageNotifications: 1, rulesChannel: guild.rulesChannelId || '1526414882231156878', publicUpdatesChannel: guild.publicUpdatesChannelId || '1526414895736946810',
                reason: 'Enable native optional interest selection requested by server owner' });
        }
        if (!sameConfiguration(current, desired)) await client.rest.put(route, { body: desired, reason: 'Optional games, ArcHouse music and news interests' });
        const verified = await client.rest.get(route);
        if (!verified.enabled || !verified.prompts.some(p => p.title === TITLE && p.options.length === 3 && !p.single_select)) throw new Error('ONBOARDING_VERIFICATION_FAILED');
        status.onboardingEnabled = true;
        log.log('[interests] onboarding enabled; three optional choices; teammate template pinned');
    } catch (error) {
        status.lastError = String(error.code || error.message || error.name).slice(0, 120);
        log.error('[interests] setup failed code=' + status.lastError);
    }
    return status;
}
module.exports = { buildOnboarding, sameConfiguration, cleanPrompt, installInterests, TITLE, DEFAULTS };
