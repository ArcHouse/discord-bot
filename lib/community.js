'use strict';
const RULES_CHANNEL = '1526414882231156878';
const RULES_MESSAGE = '1526420949828767757';
const TRACKS = '1566414392407490642';
const DISCUSSION = '1566414400837910679';
const RULES = `## Правила ZOHAN
Игры, общение и музыка ArcHouse. Здесь важны уважение и комфорт участников.

**1. Общайтесь уважительно.** Без травли, угроз, дискриминации и провокаций. Критикуйте идеи и музыку, а не человека.
**2. Без спама.** Не дублируйте сообщения, не злоупотребляйте упоминаниями и не рекламируйте серверы, товары или услуги без согласования.
**3. Ссылки — по теме.** Игровые и музыкальные ссылки разрешены в общении, играх, музыке, обсуждении ArcHouse и бот-командах. Запрещены фишинг, вредоносные файлы, пиратские раздачи и обманные розыгрыши.
**4. Музыка и авторство.** Уважайте права авторов. Не выдавайте чужие треки за свои. Обсуждайте релизы в <#${DISCUSSION}>; каталог ArcHouse — в <#${TRACKS}>.
**5. В голосовых — без помех.** Не кричите, не включайте микрофонный спам и громкие эффекты. Совместное прослушивание согласуйте с участниками.
**6. Без запрещённого контента.** Не публикуйте сексуальный контент, шокирующее насилие и материалы, нарушающие правила Discord.
**7. Личные данные защищены.** Не раскрывайте чужую переписку, контакты, адреса и другую личную информацию без согласия.
**8. Модерация.** Не обходите ограничения другими аккаунтами. Сообщайте о нарушениях модератору в личные сообщения; решение можно спокойно обсудить с владельцем. Меры зависят от тяжести и повторяемости нарушения.

Правила Discord: https://discord.com/guidelines`;
const NAV = `## ArcHouse
Музыкант • саунд-продюсер • DJ

**Слушать:** <https://soundcloud.com/archouse> · <https://open.spotify.com/artist/25B0hmV69VfIFQHOWpRveX>
**Каталог:** <#${TRACKS}> · **Обсуждение:** <#${DISCUSSION}>
Для совместного прослушивания — <#1566414409276985384>.

Новые публичные загрузки из RSS SoundCloud появляются автоматически. В карточке трека нажми «Играть».
Подписка на уведомления: **/музыка подписка:включить**. Отписка: **/музыка подписка:выключить**.

### ArcHouse — No Fear
https://soundcloud.com/archouse/no-fear-1`;
function statusText(news, music, state) {
    return `Discord: подключён\nНовости: ${news.lastResult}\nSoundCloud: ${music.lastResult}\nСохранение данных: ${state.ready && !state.lastError ? 'работает' : 'ошибка — требуется проверка'}\nПоследнее сохранение: ${state.lastSaved || 'ещё нет'}\nПроверка музыки — каждые 5 минут; бесплатный хостинг может задерживать запуск.`;
}
function createCommunity({ client, env = process.env, state, news, music, setSetting, log = console }) {
    const definitions = [
        { name: 'статус', description: 'Состояние бота, новостей, музыки и сохранения данных' },
        { name: 'новости', description: 'Канал и расписание игровых новостей' },
        { name: 'музыка', description: 'Музыка ArcHouse и добровольные уведомления', options: [{ type: 3, name: 'подписка', description: 'Уведомления о новых треках ArcHouse', required: false, choices: [{ name: 'включить', value: 'on' }, { name: 'выключить', value: 'off' }] }] },
        { name: 'настройки', description: 'Настройки приветствия и автороли (владелец)', defaultMemberPermissions: '8', options: [{ type: 7, name: 'приветствие', description: 'Канал приветствия', required: false, channelTypes: [0] }, { type: 8, name: 'автороль', description: 'Роль для новых участников без прав управления', required: false }] }
    ];
    async function install() {
        const guild = client.guilds.cache.get(env.SERVER_CONTROL_GUILD_ID);
        if (!guild) throw new Error('COMMUNITY_GUILD_MISSING');
        const existing = await guild.commands.fetch();
        for (const definition of definitions) {
            const current = existing.find(c => c.name === definition.name);
            if (current) await current.edit(definition); else await guild.commands.create(definition);
        }
        // Edit the original bot-authored messages, so rules and navigation never multiply.
        const channel = await client.channels.fetch(RULES_CHANNEL);
        const rulesMessage = await channel.messages.fetch(RULES_MESSAGE);
        if (rulesMessage.author.id !== client.user.id) throw new Error('RULES_NOT_OWN_MESSAGE');
        await rulesMessage.edit({ content: RULES, embeds: [], allowedMentions: { parse: [] } });
        if (!rulesMessage.pinned) await rulesMessage.pin('Server owner requested clear rules');
        const tracks = await client.channels.fetch(TRACKS);
        const nav = await tracks.messages.fetch('1566417631429263360');
        if (nav.author.id !== client.user.id) throw new Error('NAV_NOT_OWN_MESSAGE');
        // Keep native SoundCloud embeds; this is also the existing No Fear track post.
        await nav.edit({ content: NAV, allowedMentions: { parse: [] } });
        if (!nav.pinned) await nav.pin('ArcHouse catalog navigation');
        const commandsChannel = await client.channels.fetch('1526414889285980182');
        const help = await commandsChannel.messages.fetch('1526484514363281409');
        if (help.author.id === client.user.id) await help.edit({ content: '## Команды ZOHAN\n**/статус** — состояние бота и сохранения данных.\n**/новости** — канал и расписание рассылки.\n**/музыка** — музыка ArcHouse и добровольные уведомления.\n**/настройки** — приветствие и безопасная автороль (владелец).\n\n**Мини-игры и общение:** !help, !random, !rps, !champ, !champscores, !level, !leaderboard, !poll.\n**Jockie Music:** m!play, m!skip, m!stop, m!leave — отдельный музыкальный бот; сначала зайди в голосовой канал.\n\nСсылки разрешены в тематических чатах по правилам сервера. Команда !setup отключена; !gamenews использует существующий канал.', embeds: [], allowedMentions: { parse: [] } });
        log.log('[community] commands, rules and pinned music navigation ready');
    }
    async function handle(interaction) {
        if (!interaction.isChatInputCommand() || !definitions.some(d => d.name === interaction.commandName)) return;
        if (interaction.guildId !== env.SERVER_CONTROL_GUILD_ID) return;
        await interaction.deferReply({ flags: 64 });
        try {
            let content;
            if (interaction.commandName === 'статус') content = statusText(news, music, state.status);
            if (interaction.commandName === 'новости') content = `Игровые новости: <#${env.NEWS_CHANNEL_ID || '1527064201812508695'}>\nРасписание: 08:00, 14:00 и 20:00, Москва.\nСостояние: ${news.lastResult}\nПоследняя отправка: ${news.lastSent || 'после запуска ещё не было'}.`;
            if (interaction.commandName === 'музыка') {
                const subscription = interaction.options.getString('подписка');
                if (subscription) {
                    const role = await interaction.guild.roles.fetch(env.MUSIC_LISTENER_ROLE_ID);
                    if (!role || role.managed || role.permissions.bitfield !== 0n || !role.editable) throw new Error('LISTENER_ROLE_INVALID');
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    if (subscription === 'on') await member.roles.add(role); else await member.roles.remove(role);
                    content = subscription === 'on' ? 'Уведомления о новых треках ArcHouse включены.' : 'Уведомления о новых треках ArcHouse выключены.';
                } else content = `Музыка ArcHouse: <#${TRACKS}>\nОбсуждение: <#${DISCUSSION}>\nSoundCloud: https://soundcloud.com/archouse\nSpotify: https://open.spotify.com/artist/25B0hmV69VfIFQHOWpRveX\nПодписка на новые треки: /музыка подписка:включить`;
            }
            if (interaction.commandName === 'настройки') {
                if (interaction.user.id !== interaction.guild.ownerId) { await interaction.editReply('Настройки меняет только владелец сервера.'); return; }
                if (!state.status.ready) throw new Error('STATE_NOT_READY');
                const channel = interaction.options.getChannel('приветствие');
                const role = interaction.options.getRole('автороль');
                if (channel) await setSetting('WELCOME_CHANNEL', channel.id);
                if (role) {
                    // An auto-assigned role must not carry management or mass-mention permissions.
                    const blocked = 2n | 4n | 8n | 16n | 32n | 8192n | 131072n | (1n << 28n) | (1n << 29n) | (1n << 40n);
                    if (role.managed || !role.editable || role.id === interaction.guild.id || (role.permissions.bitfield & blocked)) throw new Error('AUTOROLE_UNSAFE');
                    await setSetting('AUTOROLE', role.id);
                }
                content = `Канал приветствия: ${env.WELCOME_CHANNEL || 'не задан'}\nАвтороль: ${env.AUTOROLE || 'не задан'}\nХранение: закрытый служебный канал; данные восстанавливаются после перезапуска.`;
            }
            await interaction.editReply({ content, allowedMentions: { parse: [] } });
        } catch (error) { log.error('[community] command failed code=' + (error.code || error.name)); await interaction.editReply('Не удалось выполнить действие. Настройка не подтверждена; проверь журнал и /статус.').catch(() => {}); }
    }
    return { install, handle, definitions };
}
module.exports = { createCommunity, RULES, NAV, statusText };
