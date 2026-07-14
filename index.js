const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Player } = require('discord-player');
const { extractors, DefaultExtractors } = require('@discord-player/extractor');
const RSSParser = require('rss-parser');
const dotenv = require('dotenv');

dotenv.config();

// Антиспам хранилище
const spamTracker = new Map();
const SPAM_LIMIT = 30;
const SPAM_TIME = 10000;

// Настройка прокси если указан
const clientOptions = {
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
    ]
};

// Если указан прокси - добавляем поддержку
if (process.env.PROXY) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const { SocksProxyAgent } = require('socks-proxy-agent');

    let agent;
    if (process.env.PROXY.startsWith('socks')) {
        agent = new SocksProxyAgent(process.env.PROXY);
    } else {
        agent = new HttpsProxyAgent(process.env.PROXY);
    }
    clientOptions.rest = { agent };
    console.log(`🔗 Используется прокси: ${process.env.PROXY}`);
}

const client = new Client(clientOptions);

const player = new Player(client);

// Регистрация экстракторов для YouTube и других источников
player.extractors.loadMulti(DefaultExtractors).then(() => {
    console.log('🎵 Экстракторы музыки загружены!');
});

// ==================== ИГРОВЫЕ НОВОСТИ ====================

const rssParser = new RSSParser();

// RSS-ленты игровых новостей (только рабочие!)
const RSS_FEEDS = [
    {
        name: 'PC Gamer',
        url: 'https://www.pcgamer.com/rss/',
        emoji: '🖥️'
    },
    {
        name: 'Eurogamer',
        url: 'https://www.eurogamer.net/feed',
        emoji: '🎮'
    },
    {
        name: 'Rock Paper Shotgun',
        url: 'https://www.rockpapershotgun.com/feed',
        emoji: '📰'
    },
    {
        name: 'VG247',
        url: 'https://www.vg247.com/feed',
        emoji: '🎯'
    },
    {
        name: 'GamesIndustry',
        url: 'https://www.gamesindustry.biz/feed',
        emoji: '📊'
    }
];

// LOL RSS-ленты
const LOL_RSS_FEEDS = [
    {
        name: 'LoL News',
        url: 'https://www.leagueoflegends.com/en-us/news/rss/',
        emoji: '⚔️'
    },
    {
        name: 'Surrender at 20',
        url: 'https://www.surrenderat20.net/feed/default',
        emoji: '🎮'
    },
    {
        name: 'LoL Esports',
        url: 'https://lolesports.com/rss',
        emoji: '🏆'
    }
];

// Хранилище опубликованных новостей (чтобы не дублировать)
const publishedNews = new Set();

// ==================== LOL ДАННЫЕ ====================

// Tier List (обновляется при запуске бота)
const LOL_TIER_LIST = {
    S_plus: ['Locke', 'Seraphine'],
    S: ['Senna', 'Jinx', 'Thresh', 'Leona'],
    A: ['Ahri', 'Syndra', 'Viktor', 'Sylas', 'Katarina'],
    B: ['Malphite', 'Garen', 'Shen', 'Ornn', 'Dr. Mundo'],
    C: ['Warwick', 'Braum', 'Vex', 'Nautilus', 'Rell']
};

// Топ сборок по позициям
const LOL_BUILDS = {
    mid: {
        Locke: { items: ['Ледяной шлем', 'Платье Рыцаря', 'Книга мертвецов'], runes: 'Электрошок' },
        Ahri: { items: ['Луден', 'Светлячок', 'Бездонная маска'], runes: 'Тайный огонь' },
        Syndra: { items: ['Луден', 'Чертоги', 'Сфера Void'], runes: 'Электрошок' }
    },
    adc: {
        Jinx: { items: ['Клятва Крушителя', 'Танцующий меч', 'Бесконечный голод'], runes: 'Фатальная скорость' },
        Senna: { items: ['Клятва Крушителя', 'Доминик', 'Смертельный танец'], runes: 'Клятва' }
    },
    support: {
        Thresh: { items: ['Зимняя гора', 'Запредельная сила', 'Воздаятель'], runes: 'Запредельная скорость' },
        Leona: { items: ['Зимняя гора', 'Запредельная сила', 'Медальон'], runes: 'Афера' }
    },
    jungle: {
        Nasus: { items: ['Джунгл предмет', 'Черный топор', 'Костяной щит'], runes: 'Градиент' },
        Nocturne: { items: ['Джунгл предмет', 'Клятва', 'Клинок'], runes: 'Электрошок' }
    },
    top: {
        Garen: { items: ['Черный топор', 'Костяной щит', 'Медальон'], runes: 'Конкистадор' },
        Malphite: { items: ['Ледяной шлем', 'Платье Рыцаря', 'Костяной щит'], runes: 'Афера' }
    }
};

// Топ контров
const LOL_COUNTERS = {
    'Locke': ['Kassadin', 'Akali', 'Riven'],
    'Jinx': ['Seraphine', 'Lux', 'Karthus'],
    'Thresh': ['Fiddlesticks', 'Amumu', 'Taric'],
    'Nasus': ['Ivern', 'Volibear', 'Bel\'Veth']
};

// Функция получения LOL новостей
async function fetchLoLNews() {
    const allNews = [];

    for (const feed of LOL_RSS_FEEDS) {
        try {
            const data = await rssParser.parseURL(feed.url);
            const items = data.items.slice(0, 3).map(item => {
                let image = null;
                if (item.enclosure?.url) {
                    image = item.enclosure.url;
                } else if (item.content) {
                    const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/);
                    if (imgMatch) image = imgMatch[1];
                }

                return {
                    title: item.title,
                    link: item.link,
                    date: item.pubDate || item.isoDate,
                    source: feed.name,
                    emoji: feed.emoji,
                    content: item.contentSnippet || item.content || '',
                    image: image
                };
            });
            allNews.push(...items);
        } catch (err) {
            console.error(`❌ Ошибка LOL RSS ${feed.name}:`, err.message);
        }
    }

    allNews.sort((a, b) => new Date(b.date) - new Date(a.date));
    return allNews.slice(0, 10);
}

// Создание Tier List embed
function createTierListEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('📊 TIER LIST - Патч 16.13')
        .setDescription('Рейтинг чемпионов по тирам (Emerald+)')
        .addFields(
            { name: '🏆 S+ Tier (ОП)', value: LOL_TIER_LIST.S_plus.map(c => `• ${c}`).join('\n'), inline: true },
            { name: '🥇 S Tier (Сильные)', value: LOL_TIER_LIST.S.map(c => `• ${c}`).join('\n'), inline: true },
            { name: '🥈 A Tier (Хорошие)', value: LOL_TIER_LIST.A.map(c => `• ${c}`).join('\n'), inline: true },
            { name: '🥉 B Tier (Нормальные)', value: LOL_TIER_LIST.B.map(c => `• ${c}`).join('\n'), inline: true }
        )
        .setFooter({ text: 'Данные: OP.GG | Обновляется каждую неделю' })
        .setTimestamp();
    return embed;
}

// Создание сборок embed
function createBuildsEmbed(position) {
    const builds = LOL_BUILDS[position];
    if (!builds) return null;

    const positionNames = {
        mid: 'Мид',
        adc: 'ADC',
        support: 'Поддержка',
        jungle: 'Джунгль',
        top: 'Топ'
    };

    const description = Object.entries(builds).map(([champ, data]) => {
        return `**${champ}**\n` +
               `🛡 Предметы: ${data.items.join(', ')}\n` +
               `🔮 Руны: ${data.runes}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle(`🛡 ТОП СБОРКИ - ${positionNames[position]}`)
        .setDescription(description)
        .setFooter({ text: 'Данные: OP.GG/U.GG | Патч 16.13' })
        .setTimestamp();
    return embed;
}

// Создание рейтинга embed
function createRatingEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🏆 РЕЙТИНГ ЧЕМПИОНОВ')
        .setDescription('Топ-5 по позициям (Win Rate)')
        .addFields(
            { name: '⚔️ Мид', value: '1. Locke (50.91%)\n2. Ahri (51.01%)\n3. Syndra (50.88%)\n4. Viktor (50.42%)\n5. Xerath (51.65%)', inline: true },
            { name: '🏹 ADC', value: '1. Senna (53.4%)\n2. Jinx (51.97%)\n3. Tristana (51.32%)\n4. Seraphine (53.89%)\n5. Kai\'Sa (50.2%)', inline: true },
            { name: '🛡 Поддержка', value: '1. Thresh (51.85%)\n2. Leona (52.12%)\n3. Nautilus (50.47%)\n4. Braum (51.86%)\n5. Sona (52.05%)', inline: true },
            { name: '🗡 Джунгль', value: '1. Nasus (53.12%)\n2. Nocturne (51.57%)\n3. Wukong (51.98%)\n4. Briar (51.67%)\n5. Sylas (50.46%)', inline: true },
            { name: '🛡 Топ', value: '1. Garen (51.76%)\n2. Malphite (51.34%)\n3. Kayle (52.02%)\n4. Shen (51.65%)\n5. Ornn (51.33%)', inline: true }
        )
        .setFooter({ text: 'Данные: OP.GG | Emerald+' })
        .setTimestamp();
    return embed;
}

// Функция получения новостей
async function fetchGameNews() {
    const allNews = [];

    for (const feed of RSS_FEEDS) {
        try {
            const data = await rssParser.parseURL(feed.url);
            const items = data.items.slice(0, 5).map(item => {
                // Извлекаем картинку из новости
                let image = null;

                // Проверяем разные источники картинок в RSS
                if (item.enclosure?.url) {
                    image = item.enclosure.url;
                } else if (item['media:thumbnail']?.$?.url) {
                    image = item['media:thumbnail'].$.url;
                } else if (item['media:content']?.$?.url) {
                    image = item['media:content'].$.url;
                } else if (item.content) {
                    // Пробуем извлечь картинку из HTML контента
                    const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/);
                    if (imgMatch) {
                        image = imgMatch[1];
                    }
                }

                return {
                    title: item.title,
                    link: item.link,
                    date: item.pubDate || item.isoDate,
                    source: feed.name,
                    emoji: feed.emoji,
                    content: item.contentSnippet || item.content || '',
                    image: image
                };
            });
            allNews.push(...items);
        } catch (err) {
            console.error(`❌ Ошибка RSS ${feed.name}:`, err.message);
        }
    }

    // Сортируем по дате (новые сверху)
    allNews.sort((a, b) => new Date(b.date) - new Date(a.date));

    return allNews.slice(0, 20); // Топ 20 новостей
}

// Функция публикации новости в канал
async function postNewsToChannel(client) {
    try {
        // Ищем канал "🎮-новости" на всех серверах
        for (const [, guild] of client.guilds.cache) {
            const newsChannel = guild.channels.cache.find(ch => ch.name.includes('новости'));
            if (!newsChannel) {
                console.log('⚠️ Канал новостей не найден на сервере:', guild.name);
                continue;
            }

            console.log(`📰 Проверяю новости для ${guild.name}...`);
            const news = await fetchGameNews();
            console.log(`📰 Получено ${news.length} новостей`);

            if (news.length === 0) {
                console.log('⚠️ Нет новостей для публикации');
                continue;
            }

            let posted = 0;
            for (const item of news) {
                // Проверяем, не публиковали ли уже эту новость
                const newsId = `${item.source}-${item.title}`;
                if (publishedNews.has(newsId)) continue;

                // Переводим заголовок и описание на русский
                const translatedTitle = await translateToRussian(item.title);
                const translatedContent = await translateToRussian(item.content);

                // Публикуем новость
                const embed = new EmbedBuilder()
                    .setColor(getColorBySource(item.source))
                    .setTitle(`${item.emoji} ${translatedTitle}`)
                    .setDescription(translatedContent.substring(0, 500) + (translatedContent.length > 500 ? '...' : ''))
                    .addFields(
                        { name: '📰 Источник', value: item.source, inline: true },
                        { name: '🕐 Дата', value: formatDate(item.date), inline: true }
                    )
                    .setURL(item.link)
                    .setTimestamp();

                // Добавляем картинку если есть
                if (item.image) {
                    try {
                        embed.setImage(item.image);
                    } catch (err) {
                        // Картинка может быть недоступна - просто пропускаем
                    }
                }

                await newsChannel.send({ embeds: [embed] }).catch(err => {
                    console.error('❌ Ошибка отправки:', err.message);
                });

                // Добавляем в опубликованные
                publishedNews.add(newsId);
                posted++;

                // Задержка между сообщениями (чтобы не спамить)
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            console.log(`✅ Опубликовано ${posted} новых новостей`);
        }
    } catch (err) {
        console.error('❌ Ошибка публикации новостей:', err);
    }
}

// Цвета по источникам
function getColorBySource(source) {
    const colors = {
        'PC Gamer': 0x0099ff,
        'Eurogamer': 0xff6600,
        'Rock Paper Shotgun': 0xffcc00,
        'VG247': 0x9933ff,
        'GamesIndustry': 0x00ff00
    };
    return colors[source] || 0x5865f2;
}

// Форматирование даты
function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'Недавно';
    }
}

// Перевод текста на русский (через бесплатный API)
async function translateToRussian(text) {
    if (!text || text.length < 10) return text;

    try {
        // Используем MyMemory API (бесплатный, без ключа)
        const encodedText = encodeURIComponent(text.substring(0, 500));
        const response = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|ru`,
            { signal: AbortSignal.timeout(5000) }
        );

        if (response.ok) {
            const data = await response.json();
            if (data.responseStatus === 200 && data.responseData?.translatedText) {
                return data.responseData.translatedText;
            }
        }
    } catch (err) {
        console.error('⚠️ Ошибка перевода:', err.message);
    }

    // Fallback: возвращаем оригинальный текст
    return text;
}

// Логирование событий плеера
player.events.on('playerStart', (queue, track) => {
    console.log(`🎵 Воспроизведение: ${track.title}`);
    console.log(`🔗 Голосовой канал: ${queue.channel?.name || 'неизвестно'}`);
});

player.events.on('playerFinish', (queue, track) => {
    console.log(`✅ Трек завершён: ${track.title}`);
});

player.events.on('playerSkip', (queue, track) => {
    console.log(`⏭️ Трек пропущен: ${track.title}`);
});

player.events.on('playerError', (queue, error, track) => {
    console.error(`❌ Ошибка плеера: ${error.message}`);
    console.error(`❌ Трек: ${track?.title || 'неизвестно'}`);
    console.error(error.stack);
});

player.events.on('error', (queue, error) => {
    console.error(`❌ Ошибка очереди: ${error.message}`);
    console.error(error.stack);
});

player.events.on('connectionError', (queue, error) => {
    console.error(`❌ Ошибка подключения: ${error.message}`);
    console.error(error.stack);
});

player.events.on('disconnect', (queue) => {
    console.log(`🔌 Отключено от голосового канала`);
});

player.events.on('emptyChannel', (queue) => {
    console.log(`📭 Канал пуст, отключаемся`);
});

player.events.on('emptyQueue', (queue) => {
    console.log(`📭 Очередь пуста`);
});

player.events.on('connectionError', (queue, error) => {
    console.error(`❌ Ошибка подключения: ${error.message}`);
});

// ==================== КОМАНДЫ ====================

const commands = new Map();

// --- МОДЕРАЦИЯ ---

commands.set('kick', {
    name: 'kick',
    description: 'Выгнать участника',
    usage: '!kick @user [причина]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            return message.reply('❌ У тебя нет прав на кик!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Укажи пользователя: !kick @user [причина]');

        const reason = args.slice(1).join(' ') || 'Не указана';

        try {
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('👢 Участник выгнан')
                .addFields(
                    { name: 'Пользователь', value: `${member.user.tag}`, inline: true },
                    { name: 'Модератор', value: `${message.author.tag}`, inline: true },
                    { name: 'Причина', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Не удалось кикнуть участника!');
        }
    }
});

commands.set('ban', {
    name: 'ban',
    description: 'Забанить участника',
    usage: '!ban @user [причина]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('❌ У тебя нет прав на бан!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Укажи пользователя: !ban @user [причина]');

        const reason = args.slice(1).join(' ') || 'Не указана';

        try {
            await member.ban({ reason });
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🔨 Участник забанен')
                .addFields(
                    { name: 'Пользователь', value: `${member.user.tag}`, inline: true },
                    { name: 'Модератор', value: `${message.author.tag}`, inline: true },
                    { name: 'Причина', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Не удалось забанить участника!');
        }
    }
});

commands.set('unban', {
    name: 'unban',
    description: 'Разбанить участника',
    usage: '!unban userID',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('❌ У тебя нет прав на разбан!');
        }

        const userId = args[0];
        if (!userId) return message.reply('❌ Укажи ID пользователя: !unban 123456789');

        try {
            await message.guild.members.unban(userId);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Участник разбанен')
                .setDescription(`Пользователь с ID ${userId} разбанен`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Не удалось разбанить участника!');
        }
    }
});

commands.set('mute', {
    name: 'mute',
    description: 'Замутить участника',
    usage: '!mute @user [минуты] [причина]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return message.reply('❌ У тебя нет прав на мут!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Укажи пользователя: !mute @user [минуты] [причина]');

        const minutes = parseInt(args[1]) || 10;
        const reason = args.slice(2).join(' ') || 'Не указана';

        try {
            await member.timeout(minutes * 60 * 1000, reason);
            const embed = new EmbedBuilder()
                .setColor(0xffa500)
                .setTitle('🔇 Участник замучен')
                .addFields(
                    { name: 'Пользователь', value: `${member.user.tag}`, inline: true },
                    { name: 'Время', value: `${minutes} мин.`, inline: true },
                    { name: 'Модератор', value: `${message.author.tag}`, inline: true },
                    { name: 'Причина', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Не удалось замутить участника!');
        }
    }
});

commands.set('unmute', {
    name: 'unmute',
    description: 'Размутить участника',
    usage: '!unmute @user',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return message.reply('❌ У тебя нет прав на unmute!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Укажи пользователя: !unmute @user');

        try {
            await member.timeout(null);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🔊 Участник размучен')
                .setDescription(`${member.user.tag} может снова писать`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Не удалось размутить участника!');
        }
    }
});

commands.set('clear', {
    name: 'clear',
    description: 'Очистить сообщения',
    usage: '!clear [количество]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return message.reply('❌ У тебя нет прав на очистку!');
        }

        const amount = parseInt(args[0]) || 10;
        if (amount < 1 || amount > 100) return message.reply('❌ Укажи число от 1 до 100!');

        try {
            await message.channel.bulkDelete(amount + 1);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🗑️ Сообщения удалены')
                .setDescription(`Удалено ${amount} сообщений`)
                .setTimestamp();
            const msg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => msg.delete(), 3000);
        } catch (err) {
            message.reply('❌ Не удалось удалить сообщения!');
        }
    }
});

// --- МИНИ-ИГРЫ ---

commands.set('random', {
    name: 'random',
    description: 'Угадай число от 1 до 100',
    usage: '!random [число]',
    execute(message, args) {
        const guess = parseInt(args[0]);
        const answer = Math.floor(Math.random() * 100) + 1;

        if (!guess) return message.reply('❌ Напиши число: !random 50');

        if (guess === answer) {
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🎉 Ты угадал!')
                .setDescription(`Число было **${answer}**! Ты молодец!`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } else {
            const hint = guess > answer ? '📉 Меньше!' : '📈 Больше!';
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('❌ Не угадал!')
                .setDescription(`${hint} Попробуй ещё раз!`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        }
    }
});

commands.set('rps', {
    name: 'rps',
    description: 'Камень-ножницы-бумага',
    usage: '!rps [камень/ножницы/бумага]',
    execute(message, args) {
        const choices = ['камень', 'ножницы', 'бумага'];
        const userChoice = args[0]?.toLowerCase();

        if (!userChoice || !choices.includes(userChoice)) {
            return message.reply('❌ Напиши: !rps камень/ножницы/бумага');
        }

        const botChoice = choices[Math.floor(Math.random() * 3)];

        let result;
        if (userChoice === botChoice) {
            result = '🤝 Ничья!';
        } else if (
            (userChoice === 'камень' && botChoice === 'ножницы') ||
            (userChoice === 'ножницы' && botChoice === 'бумага') ||
            (userChoice === 'бумага' && botChoice === 'камень')
        ) {
            result = '🏆 Ты победил!';
        } else {
            result = '💀 Ты проиграл!';
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎮 Камень-Ножницы-Бумага')
            .addFields(
                { name: 'Твой выбор', value: userChoice, inline: true },
                { name: 'Мой выбор', value: botChoice, inline: true },
                { name: 'Результат', value: result }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('roulette', {
    name: 'roulette',
    description: 'Рулетка! Ставь число 1-36 и цвет',
    usage: '!roulette [число] [красный/чёрный/зелёный]',
    execute(message, args) {
        const bet = parseInt(args[0]);
        const color = args[1]?.toLowerCase();

        if (!bet || bet < 1 || bet > 36) {
            return message.reply('❌ Ставь число от 1 до 36: !roulette 7 красный');
        }
        if (!['красный', 'чёрный', 'зелёный'].includes(color)) {
            return message.reply('❌ Укажи цвет: красный/чёрный/зелёный');
        }

        const result = Math.floor(Math.random() * 36) + 1;
        let resultColor;
        if (result === 0) resultColor = 'зелёный';
        else if (result % 2 === 0) resultColor = 'чёрный';
        else resultColor = 'красный';

        const win = bet === result;
        const colorWin = color === resultColor;

        let emoji;
        if (result === 0) emoji = '🟢';
        else if (result % 2 === 0) emoji = '⚫';
        else emoji = '🔴';

        const embed = new EmbedBuilder()
            .setColor(win ? 0x00ff00 : 0xff0000)
            .setTitle('🎰 Рулетка')
            .addFields(
                { name: 'Твоя ставка', value: `${bet} ${color}`, inline: true },
                { name: 'Выпало', value: `${emoji} ${result} ${resultColor}`, inline: true },
                { name: 'Результат', value: win ? '🏆 ДЖЕКПОТ!' : colorWin ? '✅ Цвет угадал!' : '💀 Проиграл!' }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- МУЗЫКА ---

commands.set('play', {
    name: 'play',
    description: 'Включить музыку с YouTube',
    usage: '!play [название/ссылка]',
    async execute(message, args) {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ Зайди в голосовой канал!');
        }

        const query = args.join(' ');
        if (!query) return message.reply('❌ Укажи название или ссылку: !play Never Gonna Give You Up');

        try {
            const track = await player.play(voiceChannel, query, {
                nodeOptions: {
                    metadata: { channel: message.channel },
                    leaveOnEmpty: false,
                    leaveOnEnd: false,
                    leaveOnEmptyTimeout: 300000,
                    selfDeaf: true,
                    volume: 50,
                },
                requestedBy: message.author,
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🎵 Добавлено в очередь')
                .addFields(
                    { name: 'Трек', value: track.track.title, inline: true },
                    { name: 'Длительность', value: track.track.duration, inline: true },
                    { name: 'Автор', value: track.track.author, inline: true }
                )
                .setThumbnail(track.track.thumbnail)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('❌ Ошибка музыки:', err.message);
            console.error(err.stack);
            message.reply(`❌ Ошибка: ${err.message.substring(0, 200)}`);
        }
    }
});

commands.set('skip', {
    name: 'skip',
    description: 'Пропустить текущий трек',
    async execute(message) {
        const queue = player.nodes.get(message.guild);
        if (!queue || !queue.isPlaying()) return message.reply('❌ Ничего не играет!');

        queue.node.skip();
        message.reply('⏭️ Трек пропущен!');
    }
});

commands.set('stop', {
    name: 'stop',
    description: 'Остановить музыку',
    async execute(message) {
        const queue = player.nodes.get(message.guild);
        if (!queue) return message.reply('❌ Ничего не играет!');

        queue.destroy();
        message.reply('⏹️ Музыка остановлена!');
    }
});

commands.set('queue', {
    name: 'queue',
    description: 'Показать очередь',
    async execute(message) {
        const queue = player.nodes.get(message.guild);
        if (!queue || !queue.tracks.size) return message.reply('❌ Очередь пуста!');

        const tracks = queue.tracks.map((track, i) => `${i + 1}. ${track.title} - ${track.author}`);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎶 Очередь воспроизведения')
            .setDescription(tracks.join('\n').substring(0, 2000))
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- ПРИВЕТСТВИЕ ---

commands.set('welcome', {
    name: 'welcome',
    description: 'Настроить приветственный канал',
    usage: '!welcome #channel',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может настроить приветствие!');
        }

        let channel = message.mentions.channels.first();
        if (!channel && args[0]) {
            const channelName = args[0].replace('#', '');
            channel = message.guild.channels.cache.find(ch => ch.name === channelName);
        }
        if (!channel) return message.reply('❌ Укажи канал: !welcome #общее');

        process.env.WELCOME_CHANNEL = channel.name;

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Канал приветствия настроен')
            .setDescription(`Новые участники будут приветствоваться в ${channel}`)
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- АВТО-РОЛЬ ---

commands.set('autorole', {
    name: 'autorole',
    description: 'Настроить автос роль',
    usage: '!autorole @role',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может настроить автос роль!');
        }

        const role = message.mentions.roles.first();
        if (!role) return message.reply('❌ Укажи роль: !autorole @Member');

        process.env.AUTOROLE = role.id;

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Автос роль настроена')
            .setDescription(`Новым участникам будет выдаваться роль ${role}`)
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- СЕРВЕР ---

commands.set('setup', {
    name: 'setup',
    description: 'Создать красивую структуру сервера',
    usage: '!setup',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может настроить сервер!');
        }

        const guild = message.guild;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('⚙️ Создаю структуру сервера...')
            .setDescription('Подожди несколько секунд...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            // Удаляем существующие каналы (кроме текущего)
            for (const [, channel] of guild.channels.cache) {
                if (channel.id !== message.channel.id && channel.type !== 4) {
                    await channel.delete().catch(() => {});
                }
            }
            for (const [, channel] of guild.channels.cache) {
                if (channel.id !== message.channel.id && channel.type === 4) {
                    await channel.delete().catch(() => {});
                }
            }

            // Создаём роли
            const roleAdmin = await guild.roles.create({ name: 'Admin', color: 0xff0000, permissions: [PermissionsBitField.Flags.Administrator] }).catch(() => null);
            const roleMod = await guild.roles.create({ name: 'Moderator', color: 0xffa500 }).catch(() => null);
            const roleMember = await guild.roles.create({ name: 'Member', color: 0x00ff00 }).catch(() => null);
            const roleMuted = await guild.roles.create({ name: 'Muted', color: 0x808080 }).catch(() => null);

            // Создаём категории и каналы

            // 📌 ИНФОРМАЦИЯ
            const catInfo = await guild.channels.create({ name: '📌 ИНФОРМАЦИЯ', type: 4 });
            await guild.channels.create({ name: '📜-правила', type: 0, parent: catInfo });
            await guild.channels.create({ name: '📢-объявления', type: 0, parent: catInfo });
            await guild.channels.create({ name: '🎫-тикеты', type: 0, parent: catInfo });

            // 💬 ТЕКСТОВЫЕ КАНАЛЫ
            const catText = await guild.channels.create({ name: '💬 ТЕКСТОВЫЕ КАНАЛЫ', type: 4 });
            await guild.channels.create({ name: '👋-общение', type: 0, parent: catText });
            await guild.channels.create({ name: '🎮-игры', type: 0, parent: catText });
            await guild.channels.create({ name: '🎵-музыка', type: 0, parent: catText });
            await guild.channels.create({ name: '🖼-мемы', type: 0, parent: catText });
            await guild.channels.create({ name: '🤖-бот-команды', type: 0, parent: catText });

            // 🔊 ГОЛОСОВЫЕ КАНАЛЫ
            const catVoice = await guild.channels.create({ name: '🔊 ГОЛОСОВЫЕ КАНАЛЫ', type: 4 });
            await guild.channels.create({ name: '🔊 Лобби', type: 2, parent: catVoice });
            await guild.channels.create({ name: '🎮 Игры', type: 2, parent: catVoice });
            await guild.channels.create({ name: '🎵 Музыка', type: 2, parent: catVoice });
            await guild.channels.create({ name: '💬 Разговоры', type: 2, parent: catVoice });

            // 🛡 МОДЕРАЦИЯ
            const catMod = await guild.channels.create({ name: '🛡 МОДЕРАЦИЯ', type: 4 });
            await guild.channels.create({ name: '📋-логи', type: 0, parent: catMod });
            await guild.channels.create({ name: '⚡-модерация-чат', type: 0, parent: catMod });

            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Сервер готов!')
                .setDescription('Создана красивая структура:')
                .addFields(
                    { name: '📌 Информация', value: 'Правила, Объявления, Тикеты', inline: true },
                    { name: '💬 Текстовые', value: 'Общение, Игры, Музыка, Мемы, Бот', inline: true },
                    { name: '🔊 Голосовые', value: 'Лобби, Игры, Музыка, Разговоры', inline: true },
                    { name: '🛡 Модерация', value: 'Логи, Модерация чат', inline: true },
                    { name: '🎭 Роли', value: 'Admin, Moderator, Member, Muted', inline: true }
                )
                .setTimestamp();
            msg.edit({ embeds: [successEmbed] });
        } catch (err) {
            console.error('❌ Ошибка setup:', err);
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('❌ Ошибка').setDescription(err.message)] });
        }
    }
});

// --- ИГРОВЫЕ НОВОСТИ ---

commands.set('gamenews', {
    name: 'gamenews',
    description: 'Создать категорию "🎮 ИГРОВЫЕ НОВОСТИ" с каналами для новостей',
    usage: '!gamenews',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может создавать категорию новостей!');
        }

        const guild = message.guild;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎮 Создаю категорию "ИГРОВЫЕ НОВОСТИ"...')
            .setDescription('Подожди несколько секунд...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            // Создаём категорию "🎮 ИГРОВЫЕ НОВОСТИ"
            const catGameNews = await guild.channels.create({
                name: '🎮 ИГРОВЫЕ НОВОСТИ',
                type: 4,
            });

            // Создаём канал для новостей
            const gameNewsChannel = await guild.channels.create({
                name: '🎮-новости',
                type: 0,
                parent: catGameNews,
            });

            // Создаём канал для LOL
            const lolChannel = await guild.channels.create({
                name: '⚔️-lol-гайды',
                type: 0,
                parent: catGameNews,
            });

            // Настройка прав для общего канала новостей
            const everyone = guild.roles.everyone;
            await gameNewsChannel.permissionOverwrites.edit(everyone, {
                ViewChannel: true,
                SendMessages: false,
                SendMessagesInThreads: false,
                AddReactions: false,
                EmbedLinks: false,
                AttachFiles: false,
            });

            // Настройка прав для LOL канала (только бот пишет)
            await lolChannel.permissionOverwrites.edit(everyone, {
                ViewChannel: true,
                SendMessages: false,
                SendMessagesInThreads: false,
                AddReactions: false,
                EmbedLinks: false,
                AttachFiles: false,
            });

            // Добавляем права для владельца сервера
            const owner = guild.members.cache.get(guild.ownerId);
            if (owner) {
                await gameNewsChannel.permissionOverwrites.edit(owner, {
                    ViewChannel: true, SendMessages: true, SendMessagesInThreads: true,
                    AddReactions: true, EmbedLinks: true, AttachFiles: true,
                });
                await lolChannel.permissionOverwrites.edit(owner, {
                    ViewChannel: true, SendMessages: true, SendMessagesInThreads: true,
                    AddReactions: true, EmbedLinks: true, AttachFiles: true,
                });
            }

            // Добавляем права для Admin роли
            const adminRole = guild.roles.cache.find(r => r.name === 'Admin');
            if (adminRole) {
                await gameNewsChannel.permissionOverwrites.edit(adminRole, {
                    ViewChannel: true, SendMessages: true, SendMessagesInThreads: true,
                    AddReactions: true, EmbedLinks: true, AttachFiles: true,
                });
                await lolChannel.permissionOverwrites.edit(adminRole, {
                    ViewChannel: true, SendMessages: true, SendMessagesInThreads: true,
                    AddReactions: true, EmbedLinks: true, AttachFiles: true,
                });
            }

            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Категория "🎮 ИГРОВЫЕ НОВОСТИ" создана!')
                .setDescription('Структура новостей готова:')
                .addFields(
                    { name: '📁 Категория', value: '🎮 ИГРОВЫЕ НОВОСТИ', inline: true },
                    { name: '📺 Каналы', value: '🎮-новости, ⚔️-lol-гайды', inline: true },
                    { name: '🔒 Права', value: 'Только вы и Admin могут писать', inline: true }
                )
                .setTimestamp();
            msg.edit({ embeds: [successEmbed] });
        } catch (err) {
            console.error('❌ Ошибка gamenews:', err);
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('❌ Ошибка').setDescription(err.message)] });
        }
    }
});

// --- ОБНОВИТЬ НОВОСТИ ---

commands.set('news', {
    name: 'news',
    description: 'Обновить игровые новости вручную',
    usage: '!news',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может обновлять новости!');
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎮 Обновляю игровые новости...')
            .setDescription('Подожди несколько секунд...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            await postNewsToChannel(message.client);

            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Новости обновлены!')
                .setDescription('Новые новости опубликованы в канале **🎮-новости**')
                .setTimestamp();
            msg.edit({ embeds: [successEmbed] });
        } catch (err) {
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('❌ Ошибка').setDescription(err.message)] });
        }
    }
});

// --- LOL КОМАНДЫ ---

commands.set('tierlist', {
    name: 'tierlist',
    description: 'Показать Tier List чемпионов',
    usage: '!tierlist',
    async execute(message) {
        const embed = createTierListEmbed();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('builds', {
    name: 'builds',
    description: 'Топ сборки по позиции',
    usage: '!builds [mid/adc/support/jungle/top]',
    async execute(message, args) {
        const position = args[0]?.toLowerCase();
        if (!position || !['mid', 'adc', 'support', 'jungle', 'top'].includes(position)) {
            return message.reply('❌ Укажи позицию: !builds mid/adc/support/jungle/top');
        }

        const embed = createBuildsEmbed(position);
        if (embed) {
            message.channel.send({ embeds: [embed] });
        } else {
            message.reply('❌ Сборки для этой позиции не найдены!');
        }
    }
});

commands.set('rating', {
    name: 'rating',
    description: 'Рейтинг чемпионов по позициям',
    usage: '!rating',
    async execute(message) {
        const embed = createRatingEmbed();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('counter', {
    name: 'counter',
    description: 'Показать контры чемпиона',
    usage: '!counter [имя чемпиона]',
    async execute(message, args) {
        const champ = args[0];
        if (!champ) return message.reply('❌ Укажи чемпиона: !counter Locke');

        const counters = LOL_COUNTERS[champ];
        if (!counters) return message.reply('❌ Контры для этого чемпиона не найдены!');

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle(`🛡 КОНТРЫ: ${champ}`)
            .setDescription(`Лучшие контры против **${champ}**:`)
            .addFields(
                counters.map((c, i) => ({
                    name: `${i + 1}. ${c}`,
                    value: `Победы против ${champ}: 54%+`,
                    inline: true
                }))
            )
            .setFooter({ text: 'Данные: OP.GG | Emerald+' })
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('lolnews', {
    name: 'lolnews',
    description: 'Новости League of Legends',
    usage: '!lolnews',
    async execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📰 Загружаю новости LOL...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            const news = await fetchLoLNews();

            if (news.length === 0) {
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0xffa500).setTitle('⚠️ Нет новостей').setDescription('Не удалось загрузить новости LOL')] });
            }

            const embeds = news.map(item => {
                const translatedTitle = item.title; // Will be translated by postNewsToChannel
                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle(`${item.emoji} ${item.title}`)
                    .setDescription(item.content.substring(0, 300) + '...')
                    .addFields(
                        { name: '📰 Источник', value: item.source, inline: true }
                    )
                    .setURL(item.link)
                    .setTimestamp();

                if (item.image) {
                    try { embed.setImage(item.image); } catch (e) {}
                }

                return embed;
            });

            await msg.edit({ embeds: [embeds[0]] });

            // Отправляем остальные новости
            for (let i = 1; i < Math.min(embeds.length, 5); i++) {
                await message.channel.send({ embeds: [embeds[i]] });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (err) {
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('❌ Ошибка').setDescription(err.message)] });
        }
    }
});

// --- ВЕРИФИКАЦИЯ ---

commands.set('verify', {
    name: 'verify',
    description: 'Создать систему верификации',
    usage: '!verify #канал',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может настраивать верификацию!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('❌ Укажи канал: !verify #.verify');

        let verifiedRole = message.guild.roles.cache.find(r => r.name === 'Verified');
        if (!verifiedRole) {
            verifiedRole = await message.guild.roles.create({
                name: 'Verified',
                color: 0x00ff00,
            }).catch(() => null);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('✅ Верификация')
            .setDescription('Нажми ✅ чтобы подтвердить, что ты не бот, и получить доступ к серверу!')
            .setFooter({ text: 'Без верификации ты не сможешь писать в чатах.' })
            .setTimestamp();

        const msg = await channel.send({ embeds: [embed] });
        await msg.react('✅');

        message.reply(`✅ Верификация настроена в ${channel}`);
    }
});

// --- ПРАВИЛА ---

commands.set('rules', {
    name: 'rules',
    description: 'Опубликовать правила сервера',
    usage: '!rules',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может публиковать правила!');
        }

        const rulesChannel = message.guild.channels.cache.find(ch => ch.name === '📜-правила');
        if (!rulesChannel) return message.reply('❌ Канал #📜-правила не найден!');

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📜 ПРАВИЛА СЕРВЕРА')
            .setDescription('Добро пожаловать на **Сервер ZOHAN**! Пожалуйста, ознакомьтесь с правилами перед использованием сервера.')
            .addFields(
                { name: '1️⃣ Уважение', value: 'Уважайте других участников. Запрещены оскорбления, дискриминация, расизм и любые формы харассмента.' },
                { name: '2️⃣ Спам и реклама', value: 'Запрещён спам, массовые сообщения, реклама других серверов, ботов и товаров без разрешения администратора.' },
                { name: '3️⃣ Ссылки', value: 'Запрещены сторонние ссылки в чатах. Исключение — ссылки в #🎮-игры с разрешения модератора.' },
                { name: '4️⃣ Голосовые каналы', value: 'Запрещён крик, микрофон-спам, звуковые эффекты без согласия участников. Уважайте чужое пространство.' },
                { name: '5️⃣ NSFW контент', value: 'Запрещён порнографический, жестокий и любой 18+ контент. За нарушение — бан.' },
                { name: '6️⃣ Личные данные', value: 'Запрещено публиковать личные данные других людей (адреса, телефоны, фото) без их согласия.' },
                { name: '7️⃣ Мультиаккаунты', value: 'Запрещено использование нескольких аккаунтов для обхода бана или мута.' },
                { name: '8️⃣ Админы', value: 'Следуйте инструкциям модераторов и администраторов. Их решения окончательны.' },
                { name: '9️⃣ Музыка', value: 'Используйте бота музыки только в голосовых каналах. Не злоупотребляйте командами.' },
                { name: '🔟 Здравый смысл', value: 'Если действие может навредить серверу или участникам — не делайте его.' }
            )
            .setFooter({ text: 'Нарушение правил ведёт к муту, кику или бану. Приятного общения! 🎮' })
            .setTimestamp();

        await rulesChannel.send({ embeds: [embed] });

        const successEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Правила опубликованы!')
            .setDescription(`Правила отправлены в ${rulesChannel}`)
            .setTimestamp();
        message.channel.send({ embeds: [successEmbed] });
    }
});

// --- КОМАНДЫ ДЛЯ ВСЕХ ---

commands.set('commands', {
    name: 'commands',
    description: 'Отправить публичные команды в канал',
    usage: '!commands #канал',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('❌ Укажи канал: !commands #🤖-бот-команды');

        const embed1 = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📚 КОМАНДЫ СЕРВЕРА')
            .setDescription('Все доступные команды для участников')
            .addFields(
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🎮 МИНИ-ИГРЫ**', inline: false },
                { name: '`!random [число]`', value: 'Угадай число от 1 до 100', inline: true },
                { name: '`!rps [камень/ножницы/бумага]`', value: 'Камень-ножницы-бумага', inline: true },
                { name: '`!roulette [число] [цвет]`', value: 'Рулетка (красный/чёрный/зелёный)', inline: true },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🎵 МУЗЫКА** (Jockie Music)', inline: false },
                { name: '`m!play [название/ссылка]`', value: 'Включить музыку', inline: true },
                { name: '`m!skip`', value: 'Пропустить трек', inline: true },
                { name: '`m!stop`', value: 'Остановить музыку', inline: true },
                { name: '`m!leave`', value: 'Бот выходит из голосового', inline: true },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🎉 РАЗВЛЕЧЕНИЯ**', inline: false },
                { name: '`!poll Вопрос | Вариант1 | Вариант2`', value: 'Создать опрос', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🛡️ АВТО**', inline: false },
                { name: 'Анти-спам', value: '30+ сообщений за 10 сек = мут', inline: true },
                { name: 'Анти-ссылки', value: 'Ссылки запрещены (кроме игр, музыки, бот-команд)', inline: true }
            )
            .setFooter({ text: 'Бот: Зохан младший • Музыка: Jockie Music' })
            .setTimestamp();
        await channel.send({ embeds: [embed1] });

        message.reply(`✅ Публичные команды отправлены в ${channel}`);
    }
});

// --- КОМАНДЫ ДЛЯ АДМИНОВ ---

commands.set('modcommands', {
    name: 'modcommands',
    description: 'Отправить команды модерации в канал',
    usage: '!modcommands #канал',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('❌ Укажи канал: !modcommands #⚡-модерация-чат');

        const embed1 = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🛡️ КОМАНДЫ МОДЕРАЦИИ')
            .setDescription('Только для модераторов и администраторов')
            .addFields(
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🛡️ МОДЕРАЦИЯ**', inline: false },
                { name: '`!kick @user [причина]`', value: 'Выгнать участника', inline: true },
                { name: '`!ban @user [причина]`', value: 'Забанить участника', inline: true },
                { name: '`!unban ID`', value: 'Разбанить участника', inline: true },
                { name: '`!mute @user [минуты] [причина]`', value: 'Замутить участника', inline: true },
                { name: '`!unmute @user`', value: 'Размутить участника', inline: true },
                { name: '`!clear [кол-во]`', value: 'Удалить сообщения', inline: true },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**⚙️ НАСТРОЙКА СЕРВЕРА**', inline: false },
                { name: '`!setup`', value: 'Автосоздание структуры сервера', inline: true },
                { name: '`!rules`', value: 'Опубликовать правила', inline: true },
                { name: '`!welcome #канал`', value: 'Настроить приветствие', inline: true },
                { name: '`!autorole @роль`', value: 'Настроить автос роль', inline: true },
                { name: '`!verify #канал`', value: 'Настроить верификацию', inline: true },
                { name: '`!reactrole #канал | Роль:эмодзи`', value: 'Роли по реакциям', inline: false },
                { name: '`!giveaway время | приз | описание`', value: 'Розыгрыш (секунды)', inline: false },
                { name: '`!commands #канал`', value: 'Публичные команды', inline: true },
                { name: '`!modcommands #канал`', value: 'Этот список', inline: true },
                { name: '`!gamenews`', value: 'Создать категорию "🎮 ИГРОВЫЕ НОВОСТИ"', inline: true },
                { name: '`!news`', value: 'Обновить новости вручную', inline: true },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🛡️ АВТОМАТИЧЕСКИ**', inline: false },
                { name: 'Логирование', value: 'Удаление/редактирование в #📋-логи', inline: true },
                { name: 'Прощание', value: 'Сообщение когда кто-то вышел', inline: true }
            )
            .setFooter({ text: 'Только для модераторов!' })
            .setTimestamp();
        await channel.send({ embeds: [embed1] });

        message.reply(`✅ Команды модерации отправлены в ${channel}`);
    }
});

// --- СПРЯТАТЬ МОД КАНАЛЫ ---

commands.set('lockmod', {
    name: 'lockmod',
    description: 'Спрятать модераторские каналы от обычных участников',
    usage: '!lockmod',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может!');
        }

        const everyone = message.guild.roles.everyone;
        const modChannels = ['📋-логи', '⚡-модерация-чат'];

        for (const name of modChannels) {
            const channel = message.guild.channels.cache.find(ch => ch.name === name);
            if (!channel) continue;

            await channel.permissionOverwrites.edit(everyone, {
                ViewChannel: false,
            }).catch(() => {});

            // Добавляем права для Admin и Moderator если их роли есть
            const adminRole = message.guild.roles.cache.find(r => r.name === 'Admin');
            const modRole = message.guild.roles.cache.find(r => r.name === 'Moderator');

            if (adminRole) {
                await channel.permissionOverwrites.edit(adminRole, {
                    ViewChannel: true,
                }).catch(() => {});
            }
            if (modRole) {
                await channel.permissionOverwrites.edit(modRole, {
                    ViewChannel: true,
                }).catch(() => {});
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🔒 Модераторские каналы скрыты')
            .setDescription('Каналы **#📋-логи** и **#⚡-модерация-чат** теперь видны только модераторам и админам.')
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- УДАЛИТЬ ТИКЕТЫ ---

commands.set('deltickets', {
    name: 'deltickets',
    description: 'Удалить канал тикетов',
    usage: '!deltickets',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может!');
        }

        const channel = message.guild.channels.cache.find(ch => ch.name === '🎫-тикеты');
        if (!channel) return message.reply('❌ Канал тикетов не найден!');

        await channel.delete().catch(() => {});
        message.reply('✅ Канал тикетов удалён!');
    }
});

// --- ПОМОЩЬ ---

commands.set('help', {
    name: 'help',
    description: 'Показать все команды',
    execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📚 Команды бота')
            .setDescription('Все доступные команды:')
            .addFields(
                { name: '🛡️ Модерация', value: '`!kick` `!ban` `!unban` `!mute` `!unmute` `!clear`' },
                { name: '🎮 Мини-игры', value: '`!random` `!rps` `!roulette`' },
                { name: '🎵 Музыка', value: '`!play` `!skip` `!stop` `!queue`' },
                { name: '🎉 Розыгрыши', value: '`!giveaway`' },
                { name: '📊 Опросы', value: '`!poll`' },
                { name: '🎭 Роли', value: '`!reactrole` `!verify`' },
                { name: '⚙️ Сервер', value: '`!setup` `!rules` `!welcome` `!autorole` `!verify` `!commands` `!modcommands` `!help`' },
                { name: '🎮 Новости', value: '`!gamenews` `!news`' },
                { name: '⚔️ League of Legends', value: '`!tierlist` `!builds` `!rating` `!counter` `!lolnews`' },
                { name: '🤖 Авто', value: 'Анти-спам, Анти-ссылки, Логирование, Приветствие/Прощание' }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- РОЛИ ПО РЕАКЦИЯМ ---

commands.set('reactrole', {
    name: 'reactrole',
    description: 'Создать сообщение с ролями по реакциям',
    usage: '!reactrole #канал | Роль1:эмодзи | Роль2:эмодзи',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может настраивать роли по реакциям!');
        }

        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('❌ Формат: !reactrole # канал | Роль1:🎭 | Роль2:🎮');

        const channelMention = parts[0];
        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === channelMention.replace('#', ''));
        if (!channel) return message.reply('❌ Канал не найден!');

        const rolePairs = parts.slice(1);
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎭 Выбери роль!')
            .setDescription('Нажми на эмодзи чтобы получить роль:')
            .setTimestamp();

        const description = [];
        for (const pair of rolePairs) {
            const [roleName, emoji] = pair.split(':').map(s => s.trim());
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (role) {
                description.push(`${emoji} — ${role}`);
            }
        }
        embed.setDescription(description.join('\n'));

        const msg = await channel.send({ embeds: [embed] });

        for (const pair of rolePairs) {
            const [roleName, emoji] = pair.split(':').map(s => s.trim());
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (role && emoji) {
                await msg.react(emoji);
            }
        }

        message.reply('✅ Роли по реакциям созданы!');
    }
});

// --- РОЗЫГРЫШИ ---

const giveaways = new Map();

commands.set('giveaway', {
    name: 'giveaway',
    description: 'Создать розыгрыш',
    usage: '!giveaway 60 | Приз | Описание',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ может создавать розыгрыши!');
        }

        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('❌ Формат: !giveaway 60 | Приз | Описание');

        const time = parseInt(parts[0]) * 1000;
        const prize = parts[1];
        const description = parts[2] || 'Участвуй!';

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🎉 РОЗЫГРЫШ!')
            .setDescription(`**Приз:** ${prize}\n\n${description}\n\n⏰ Заканчивается через: ${Math.floor(time / 60000)} мин.`)
            .setFooter({ text: 'Нажми 🎉 чтобы участвовать!' })
            .setTimestamp();

        const msg = await message.channel.send({ embeds: [embed] });
        await msg.react('🎉');

        giveaways.set(msg.id, {
            prize,
            endTime: Date.now() + time,
            messageId: msg.id,
            channelId: message.channel.id,
            guildId: message.guild.id,
        });

        message.reply(`✅ Розыгрыш создан! Заканчивается через ${Math.floor(time / 60000)} мин.`);
    }
});

// --- ОПРОСЫ ---

commands.set('poll', {
    name: 'poll',
    description: 'Создать опрос',
    usage: '!poll Вопрос | Вариант1 | Вариант2',
    async execute(message, args) {
        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('❌ Формат: !poll Вопрос | Вариант1 | Вариант2');

        const question = parts[0];
        const options = parts.slice(1);
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        const description = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n');
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📊 ${question}`)
            .setDescription(description)
            .setFooter({ text: `Опрос от ${message.author.tag}` })
            .setTimestamp();

        const msg = await message.channel.send({ embeds: [embed] });

        for (let i = 0; i < options.length; i++) {
            await msg.react(emojis[i]);
        }

        message.delete().catch(() => {});
    }
});

// --- ПРОЩАНИЕ ---

// --- АВТО-АНМАТ (РЕАКЦИИ) ---

// ==================== СОБЫТИЯ ====================

client.on('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    client.user.setActivity('!help | Играю в игры', { type: ActivityType.Playing });

    // ==================== РАСПИСАНИЕ ОБНОВЛЕНИЙ ====================

    // Функция проверки времени
    function isUpdateHour(hours) {
        const now = new Date().getHours();
        return hours.includes(now);
    }

    // 📰 ИГРОВЫЕ НОВОСТИ - каждые 4 часа (10:00, 14:00, 18:00, 22:00)
    const newsHours = [10, 14, 18, 22];
    console.log(`📰 Игровые новости: ${newsHours.join(':00, ')}:00`);

    // ⚔️ LOL TIER LIST - каждые 6 часов (09:00, 15:00, 21:00)
    const tierListHours = [9, 15, 21];
    console.log(`⚔️ LOL Tier List: ${tierListHours.join(':00, ')}:00`);

    // 🛡 LOL СБОРКИ - каждые 8 часов (10:00, 18:00)
    const buildsHours = [10, 18];
    console.log(`🛡 LOL Сборки: ${buildsHours.join(':00, ')}:00`);

    // 🏆 LOL РЕЙТИНГ - каждые 12 часов (12:00, 00:00)
    const ratingHours = [0, 12];
    console.log(`🏆 LOL Рейтинг: ${ratingHours.join(':00, ')}:00`);

    // Проверяем каждые 30 минут
    setInterval(async () => {
        const currentHour = new Date().getHours();

        // 📰 Игровые новости
        if (newsHours.includes(currentHour)) {
            console.log('📰 Обновляю игровые новости...');
            await postNewsToChannel(client);
        }

        // ⚔️ LOL Tier List
        if (tierListHours.includes(currentHour)) {
            console.log('⚔️ Обновляю LOL Tier List...');
            for (const [, guild] of client.guilds.cache) {
                const lolChannel = guild.channels.cache.find(ch => ch.name.includes('lol'));
                if (lolChannel) {
                    await lolChannel.send({ embeds: [createTierListEmbed()] }).catch(() => {});
                }
            }
        }

        // 🛡 LOL Сборки
        if (buildsHours.includes(currentHour)) {
            console.log('🛡 Обновляю LOL Сборки...');
            for (const [, guild] of client.guilds.cache) {
                const lolChannel = guild.channels.cache.find(ch => ch.name.includes('lol'));
                if (lolChannel) {
                    await lolChannel.send({ embeds: [createBuildsEmbed('mid')] }).catch(() => {});
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await lolChannel.send({ embeds: [createBuildsEmbed('adc')] }).catch(() => {});
                }
            }
        }

        // 🏆 LOL Рейтинг
        if (ratingHours.includes(currentHour)) {
            console.log('🏆 Обновляю LOL Рейтинг...');
            for (const [, guild] of client.guilds.cache) {
                const lolChannel = guild.channels.cache.find(ch => ch.name.includes('lol'));
                if (lolChannel) {
                    await lolChannel.send({ embeds: [createRatingEmbed()] }).catch(() => {});
                }
            }
        }
    }, 30 * 60 * 1000); // Проверяем каждые 30 минут
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.PREFIX)) return;

    const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args);
    } catch (error) {
        console.error(error);
        message.reply('❌ Произошла ошибка при выполнении команды!');
    }
});

// Приветствие новых участников
client.on('guildMemberAdd', async (member) => {
    const channel = member.guild.channels.cache.find(ch => ch.name === process.env.WELCOME_CHANNEL);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('👋 Добро пожаловать!')
            .setDescription(`Привет, ${member}! Добро пожаловать на сервер **${member.guild.name}**!`)
            .addFields(
                { name: 'Участников', value: `${member.guild.memberCount}`, inline: true },
                { name: 'Создан', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        channel.send({ embeds: [embed] });
    }

    const roleId = process.env.AUTOROLE;
    if (roleId && roleId !== '@Member') {
        const role = member.guild.roles.cache.get(roleId);
        if (role) {
            try { await member.roles.add(role); } catch (err) {}
        }
    }
});

// ПРОЩАНИЕ участников
client.on('guildMemberRemove', async (member) => {
    const logChannel = member.guild.channels.cache.find(ch => ch.name === '📋-логи');
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('👋 Участник покинул сервер')
            .setDescription(`**${member.user.tag}** вышел с сервера`)
            .addFields(
                { name: 'Участников осталось', value: `${member.guild.memberCount}`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        logChannel.send({ embeds: [embed] });
    }
});

// ЛОГИРОВАНИЕ: удалённые сообщения
client.on('messageDelete', async (message) => {
    if (message.author.bot) return;
    const logChannel = message.guild.channels.cache.find(ch => ch.name === '📋-логи');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('🗑️ Сообщение удалено')
        .addFields(
            { name: 'Автор', value: `${message.author.tag}`, inline: true },
            { name: 'Канал', value: `${message.channel}`, inline: true },
            { name: 'Контент', value: message.content.substring(0, 1000) || 'Нет текста' }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// ЛОГИРОВАНИЕ: edited сообщения
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    const logChannel = oldMessage.guild.channels.cache.find(ch => ch.name === '📋-логи');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('✏️ Сообщение изменено')
        .addFields(
            { name: 'Автор', value: `${oldMessage.author.tag}`, inline: true },
            { name: 'Канал', value: `${oldMessage.channel}`, inline: true },
            { name: 'Было', value: oldMessage.content.substring(0, 500) || 'Нет текста' },
            { name: 'Стало', value: newMessage.content.substring(0, 500) || 'Нет текста' }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// ЛОГИРОВАНИЕ: бан/кик
client.on('guildBanAdd', async (ban) => {
    const logChannel = ban.guild.channels.cache.find(ch => ch.name === '📋-логи');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔨 Участник забанен')
        .addFields(
            { name: 'Пользователь', value: `${ban.user.tag}`, inline: true },
            { name: 'Причина', value: ban.reason || 'Не указана', inline: true }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// ЛОГИРОВАНИЕ: разбан
client.on('guildBanRemove', async (ban) => {
    const logChannel = ban.guild.channels.cache.find(ch => ch.name === '📋-логи');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Участник разбанен')
        .addFields(
            { name: 'Пользователь', value: `${ban.user.tag}`, inline: true }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// АНТИ-СПАМ и АНТИ-ССЫЛКИ
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    const userId = message.author.id;
    const now = Date.now();

    // Анти-спам
    if (!spamTracker.has(userId)) spamTracker.set(userId, []);
    const timestamps = spamTracker.get(userId);
    timestamps.push(now);
    const recent = timestamps.filter(t => now - t < SPAM_TIME);
    spamTracker.set(userId, recent);

    if (recent.length > SPAM_LIMIT) {
        try {
            await message.delete();
            const mute = message.guild.roles.cache.find(r => r.name === 'Muted');
            if (mute) await message.member.roles.add(mute);
            const warn = await message.channel.send(`⚠️ ${message.author}, замучен на 1 минуту за спам!`);
            setTimeout(() => {
                if (mute) message.member.roles.remove(mute).catch(() => {});
            }, 60000);
            setTimeout(() => warn.delete(), 8000);

            const logChannel = message.guild.channels.cache.find(ch => ch.name === '📋-логи');
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle('⚠️ Анти-спам')
                    .setDescription(`${message.author.tag} замучен на 1 минуту за спам`)
                    .setTimestamp();
                logChannel.send({ embeds: [embed] });
            }
        } catch (err) {}
        return;
    }

    // Предупреждение за спам
    if (recent.length === SPAM_LIMIT - 1) {
        const warn = await message.channel.send(`⚠️ ${message.author}, замедли! Следующее сообщение = мут.`);
        setTimeout(() => warn.delete(), 4000);
    }

    // Анти-ссылки (разрешены в каналах: игры, музыка, бот-команды)
    const allowedChannels = ['🎮-игры', '🎵-музыка', '👋-общение', 'общее'];
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/i;
    if (urlRegex.test(message.content) && !allowedChannels.includes(message.channel.name)) {
        try {
            await message.delete();
            const warn = await message.channel.send(`🚫 ${message.author}, ссылки запрещены в этом канале!`);
            setTimeout(() => warn.delete(), 3000);
        } catch (err) {}
    }
});

// РЕАКЦИИ: обработка Reaction Roles и Верификация
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();

    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);

    // Верификация
    if (reaction.emoji.name === '✅') {
        const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
        if (verifiedRole && !member.roles.cache.has(verifiedRole.id)) {
            await member.roles.add(verifiedRole).catch(() => {});
            const ch = guild.channels.cache.find(ch => ch.name === '👋-общение');
            if (ch) ch.send(`✅ ${member} верифицирован! Добро пожаловать!`).then(m => setTimeout(() => m.delete(), 5000));
        }
    }
});

// РОЗЫГРЫШИ: обработка таймеров
setInterval(async () => {
    for (const [id, giveaway] of giveaways) {
        if (Date.now() >= giveaway.endTime) {
            const guild = client.guilds.cache.get(giveaway.guildId);
            if (!guild) { giveaways.delete(id); continue; }

            const channel = guild.channels.cache.get(giveaway.channelId);
            if (!channel) { giveaways.delete(id); continue; }

            try {
                const msg = await channel.messages.fetch(giveaway.messageId);
                const reactions = msg.reactions.cache.get('🎉');
                if (!reactions) {
                    await channel.send('🎉 Розыгрыш завершён, но никто не участвовал!');
                    giveaways.delete(id);
                    continue;
                }

                const users = await reactions.users.fetch();
                const participants = users.filter(u => !u.bot);
                if (participants.size === 0) {
                    await channel.send('🎉 Розыгрыш завершён, но никто не участвовал!');
                } else {
                    const winner = participants.random();
                    const embed = new EmbedBuilder()
                        .setColor(0xffd700)
                        .setTitle('🎉 ПОБЕДИТЕЛЬ!')
                        .setDescription(`**${winner}** выиграл **${giveaway.prize}**!`);
                    await channel.send({ embeds: [embed] });
                }
            } catch (err) {}

            giveaways.delete(id);
        }
    }
}, 10000);

// ==================== ЗАПУСК ====================

client.login(process.env.TOKEN);
