const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType, ChannelType } = require('discord.js');
const RSSParser = require('rss-parser');
const TelegramBot = require('node-telegram-bot-api');
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

// ==================== TELEGRAM BOT ====================

// Telegram бот для связи Discord ↔ Telegram
let telegramBot = null;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Функция отправки сообщения в Telegram
async function sendToTelegram(message, fromDiscord = true) {
    if (!telegramBot || !TELEGRAM_CHAT_ID) return;

    try {
        const prefix = fromDiscord ? '💬 Discord: ' : '';
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, prefix + message);
    } catch (err) {
        console.log('⚠️ Telegram ошибка:', err.message);
    }
}

// Функция отправки embed в Telegram
async function sendEmbedToTelegram(embed, fromDiscord = true) {
    if (!telegramBot || !TELEGRAM_CHAT_ID) return;

    try {
        const prefix = fromDiscord ? '💬 Discord:\n' : '';
        let text = prefix + embed.title + '\n\n';
        if (embed.description) text += embed.description + '\n';
        if (embed.fields) {
            embed.fields.forEach(f => {
                text += `\n${f.name}: ${f.value}`;
            });
        }
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, text.substring(0, 4000));
    } catch (err) {
        console.log('⚠️ Telegram embed ошибка:', err.message);
    }
}

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

// LOL RSS-ленты (только LOL-специфичные источники)
const LOL_RSS_FEEDS = [
    {
        name: 'Surrender at 20',
        url: 'https://www.surrenderat20.net/feeds/posts/default?alt=rss',
        emoji: '📰',
        lolOnly: true
    },
    {
        name: 'LoL Esports',
        url: 'https://lolesports.com/rss',
        emoji: '🏆',
        lolOnly: true
    },
    {
        name: 'LeagueFeed',
        url: 'https://www.leaguefeed.net/feed',
        emoji: '🎮',
        lolOnly: true
    }
];

// Ключевые слова LOL для фильтрации контента
const LOL_KEYWORDS = [
    'league of legends', 'lol', 'riot', 'summoner', 'rift', 'champion', 'patch',
    'ARAM', 'summoners rift', 'ranked', 'diamond', 'emerald', 'platinum', 'gold',
    'silver', 'bronze', 'master', 'grandmaster', 'challenger', 'pro player',
    'worlds', 'msi', 'lcs', 'lec', 'lck', 'lpl', ' worlds championship',
    'ahri', 'yasuo', 'jinx', 'thresh', 'garen', 'darius', 'vayne', 'caitlyn',
    'lux', 'fizz', 'katarina', 'zed', 'irelia', 'riven', 'lee sin', 'master yi',
    'teemo', 'annie', 'ashe', 'soraka', 'blitzcrank', 'morgana', 'leona',
    'skin', 'battle pass', 'arcane', 'tft', 'teamfight tactics',
    'patch notes', 'balance', 'nerf', 'buff', 'rework', 'new champion',
    'lcs', 'lec', 'lck', 'lpl', 'worlds', 'all star', 'mid season'
];

// Проверка является ли текст о League of Legends
function isLoLContent(title, content) {
    const text = (title + ' ' + content).toLowerCase();
    return LOL_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

// ==================== TWITCH УВЕДОМЛЕНИЯ ====================

// Twitch каналы для отслеживания
const TWITCH_CHANNELS = [
    { name: 'BubaLeggg', login: 'bubaleggg' }
];

// Хранилище статуса стримов
const streamStatus = new Map();

// Проверка стримов на Twitch
async function checkTwitchStreams(client) {
    for (const channel of TWITCH_CHANNELS) {
        try {
            // Используем публичный API для проверки статуса
            const url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel.login}-320x180.jpg`;
            
            // Проверяем через fetch
            const response = await fetch(url, { method: 'HEAD' });
            const isLive = response.ok;
            
            const wasLive = streamStatus.get(channel.login) || false;
            
            // Если стрим начался
            if (isLive && !wasLive) {
                console.log(`🔴 ${channel.name} начал стрим!`);
                
                // Ищем канал объявления
                for (const [, guild] of client.guilds.cache) {
                    const announceChannel = guild.channels.cache.find(ch => 
                        ch.name.includes('объявления') || ch.name.includes('announce')
                    );
                    if (announceChannel) {
                        await announceChannel.send({ embeds: [
                            new EmbedBuilder()
                                .setColor(0x9146ff)
                                .setTitle('🔴 СТРИМ НАЧАЛСЯ!')
                                .setDescription(`**${channel.name}** начал прямую трансляцию!`)
                                .addFields(
                                    { name: '📺 Канал', value: `https://twitch.tv/${channel.login}`, inline: true },
                                    { name: '🎮 Игра', value: 'League of Legends', inline: true }
                                )
                                .setThumbnail(`https://static-cdn.jtvnw.net/jtv_user_pictures/${channel.login}-profile_image-70x70.png`)
                                .setTimestamp()
                        ]}).catch(() => {});
                    }
                }
            }
            
            // Если стрим закончился
            if (!isLive && wasLive) {
                console.log(`⚫ ${channel.name} закончил стрим`);
            }
            
            streamStatus.set(channel.login, isLive);
            
        } catch (err) {
            console.log('⚠️ Twitch ошибка:', err.message.substring(0, 50));
        }
    }
}

// Хранилище опубликованных новостей (чтобы не дублировать)
const publishedNews = new Set();

// ==================== LOL ДАННЫЕ (OP.GG УРОВЕНЬ) ====================

// Tier List
const LOL_TIER_LIST = {
    S_plus: ['Ahri', 'Jinx', 'Senna'],
    S: ['Thresh', 'Leona', 'Fizz', 'Katarina'],
    A: ['Syndra', 'Viktor', 'Xerath', 'Nasus', 'Garen'],
    B: ['Malphite', 'Shen', 'Ornn', 'Diana', 'Lissandra']
};

// Реальная статистика чемпионов с OP.GG
const LOL_CHAMPIONS = {
    // МИД
    mid: [
        { name: 'Ahri', winRate: '51.01%', pickRate: '9.02%', banRate: '3.13%', tier: 'S', rune: 'Тайный огонь', items: ['Луден', 'Светлячок', 'Бездонная маска'] },
        { name: 'Syndra', winRate: '50.88%', pickRate: '7.46%', banRate: '4.73%', tier: 'S', rune: 'Электрошок', items: ['Луден', 'Чертоги', 'Сфера Void'] },
        { name: 'Viktor', winRate: '50.42%', pickRate: '8.62%', banRate: '8.16%', tier: 'A', rune: 'Электрошок', items: ['Луден', 'Чертоги', 'Бездонная маска'] },
        { name: 'Xerath', winRate: '51.65%', pickRate: '4.61%', banRate: '8.07%', tier: 'S', rune: 'Электрошок', items: ['Луден', 'Светлячок', 'Чертоги'] },
        { name: 'Fizz', winRate: '51.56%', pickRate: '5.22%', banRate: '6.37%', tier: 'S', rune: 'Электрошок', items: ['Луден', 'Пламя Рыцаря', 'Бездонная маска'] },
        { name: 'Katarina', winRate: '51.15%', pickRate: '6.82%', banRate: '9.99%', tier: 'S', rune: 'Электрошок', items: ['Луден', 'Пламя Рыцаря', 'Бездонная маска'] },
        { name: 'Diana', winRate: '51.47%', pickRate: '4.36%', banRate: '4.87%', tier: 'A', rune: 'Электрошок', items: ['Луден', 'Пламя Рыцаря', 'Бездонная маска'] },
        { name: 'Lissandra', winRate: '51.12%', pickRate: '5.1%', banRate: '3.05%', tier: 'A', rune: 'Электрошок', items: ['Луден', 'Светлячок', 'Бездонная маска'] }
    ],
    // ADC
    adc: [
        { name: 'Jinx', winRate: '51.97%', pickRate: '11.42%', banRate: '2.25%', tier: 'S+', rune: 'Фатальная скорость', items: ['Клятва Крушителя', 'Танцующий меч', 'Бесконечный голод'] },
        { name: 'Senna', winRate: '53.4%', pickRate: '8.89%', banRate: '22.19%', tier: 'S+', rune: 'Клятва', items: ['Клятва Крушителя', 'Доминик', 'Смертельный танец'] },
        { name: 'Tristana', winRate: '51.32%', pickRate: '7.17%', banRate: '2.53%', tier: 'A', rune: 'Фатальная скорость', items: ['Клятва Крушителя', 'Танцующий меч', 'Бесконечный голод'] },
        { name: 'Seraphine', winRate: '53.89%', pickRate: '3.02%', banRate: '11.62%', tier: 'S+', rune: 'Электрошок', items: ['Луден', 'Светлячок', 'Бездонная маска'] }
    ],
    // ПОДДЕРЖКА
    support: [
        { name: 'Thresh', winRate: '51.85%', pickRate: '13.54%', banRate: '8.09%', tier: 'S+', rune: 'Запредельная скорость', items: ['Зимняя гора', 'Запредельная сила', 'Воздаятель'] },
        { name: 'Leona', winRate: '52.12%', pickRate: '7.49%', banRate: '6.85%', tier: 'S', rune: 'Афера', items: ['Зимняя гора', 'Запредельная сила', 'Медальон'] },
        { name: 'Nautilus', winRate: '50.47%', pickRate: '10.47%', banRate: '13.89%', tier: 'A', rune: 'Афера', items: ['Зимняя гора', 'Запредельная сила', 'Медальон'] },
        { name: 'Braum', winRate: '51.86%', pickRate: '4.54%', banRate: '5.5%', tier: 'A', rune: 'Афера', items: ['Зимняя гора', 'Запредельная сила', 'Медальон'] },
        { name: 'Sona', winRate: '52.05%', pickRate: '3%', banRate: '0.2%', tier: 'A', rune: 'Электрошок', items: ['Зимняя гора', 'Запредельная сила', 'Медальон'] }
    ],
    // ДЖУНГЛЬ
    jungle: [
        { name: 'Nasus', winRate: '53.12%', pickRate: '3.57%', banRate: '7.1%', tier: 'S+', rune: 'Градиент', items: ['Джунгл предмет', 'Черный топор', 'Костяной щит'] },
        { name: 'Nocturne', winRate: '51.57%', pickRate: '7.23%', banRate: '12.87%', tier: 'S', rune: 'Электрошок', items: ['Джунгл предмет', 'Клятва', 'Клинок'] },
        { name: 'Wukong', winRate: '51.98%', pickRate: '5.79%', banRate: '1.97%', tier: 'S', rune: 'Электрошок', items: ['Джунгл предмет', 'Клятва', 'Клинок'] },
        { name: 'Briar', winRate: '51.67%', pickRate: '4.91%', banRate: '8.23%', tier: 'A', rune: 'Электрошок', items: ['Джунгл предмет', 'Клятва', 'Клинок'] },
        { name: 'Sylas', winRate: '50.46%', pickRate: '8.48%', banRate: '18.66%', tier: 'A', rune: 'Электрошок', items: ['Джунгл предмет', 'Луден', 'Бездонная маска'] }
    ],
    // ТОП
    top: [
        { name: 'Garen', winRate: '51.76%', pickRate: '8.16%', banRate: '6.9%', tier: 'S', rune: 'Конкистадор', items: ['Черный топор', 'Костяной щит', 'Медальон'] },
        { name: 'Malphite', winRate: '51.34%', pickRate: '7.01%', banRate: '17.88%', tier: 'S', rune: 'Афера', items: ['Ледяной шлем', 'Платье Рыцаря', 'Костяной щит'] },
        { name: 'Kayle', winRate: '52.02%', pickRate: '2.52%', banRate: '2.34%', tier: 'A', rune: 'Конкистадор', items: ['Черный топор', 'Костяной щит', 'Медальон'] },
        { name: 'Shen', winRate: '51.65%', pickRate: '4.02%', banRate: '0.95%', tier: 'A', rune: 'Афера', items: ['Зимняя гора', 'Запредельная сила', 'Костяной щит'] },
        { name: 'Ornn', winRate: '51.33%', pickRate: '3.79%', banRate: '0.61%', tier: 'A', rune: 'Афера', items: ['Зимняя гора', 'Запредельная сила', 'Костяной щит'] }
    ]
};

// Картинки чемпионов (Riot Data Dragon - работает!)
function getChampionImage(championName) {
    const champId = {
        'Ahri': 'Ahri', 'Syndra': 'Syndra', 'Viktor': 'Viktor', 'Xerath': 'Xerath',
        'Fizz': 'Fizz', 'Katarina': 'Katarina', 'Diana': 'Diana', 'Lissandra': 'Lissandra',
        'Jinx': 'Jinx', 'Senna': 'Senna', 'Tristana': 'Tristana', 'Seraphine': 'Seraphine',
        'Thresh': 'Thresh', 'Leona': 'Leona', 'Nautilus': 'Nautilus', 'Braum': 'Braum', 'Sona': 'Sona',
        'Nasus': 'Nasus', 'Nocturne': 'Nocturne', 'Wukong': 'MonkeyKing', 'Briar': 'Briar', 'Sylas': 'Sylas',
        'Garen': 'Garen', 'Malphite': 'Malphite', 'Kayle': 'Kayle', 'Shen': 'Shen', 'Ornn': 'Ornn'
    };
    const id = champId[championName] || championName;
    return `https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/${id}.png`;
}

// Картинки предметов (Riot Data Dragon)
function getItemImage(itemName) {
    const items = {
        'Луден': '3285',        // Luden's Tempest
        'Светлячок': '4628',    // Horizon Focus
        'Бездонная маска': '4645', // Shadowflame
        'Чертоги': '4637',      // Cryptbloom
        'Сфера Void': '3135',   // Void Staff
        'Пламя Рыцаря': '3142', // Youmuu's Ghostblade
        'Клятва Крушителя': '3153', // Immortal Shieldbow
        'Танцующий меч': '3124', // Guinsoo's Rageblade
        'Бесконечный голод': '3031', // Infinity Edge
        'Доминик': '3036',      // Lord Dominik's Regards
        'Смертельный танец': '3156', // Death's Dance
        'Зимняя гора': '3857',  // Steel Shoulderguards
        'Запредельная сила': '3190', // Locket of the Iron Solari
        'Воздаятель': '3107',   // Redemption
        'Медальон': '3190',     // Locket
        'Черный топор': '3071', // Black Cleaver
        'Костяной щит': '3068', // Sunfire Aegis
        'Джунгл предмет': '1101', // Hailblade
        'Клятва': '3153',       // Immortal Shieldbow
        'Клинок': '3134',       // Serrated Dirk
        'Ледяной шлем': '3116', // Rylai's Crystal Scepter
        'Платье Рыцаря': '3157' // Zhonya's Hourglass
    };
    const itemId = items[itemName] || '1001'; // Default boot if not found
    return `https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/${itemId}.png`;
}

// ТIER EMOJI
function getTierEmoji(tier) {
    const emojis = { 'S+': '🏆', 'S': '🥇', 'A': '🥈', 'B': '🥉', 'C': '📊' };
    return emojis[tier] || '📊';
}

// TIER COLOR
function getTierColor(tier) {
    const colors = { 'S+': 0xffd700, 'S': 0xff6600, 'A': 0x00ff00, 'B': 0x0099ff, 'C': 0x999999 };
    return colors[tier] || 0x5865f2;
}

// Создание Tier List embed (КРАСИВО С КАРТИНКАМИ)
function createTierListEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('📊 TIER LIST — Патч 16.13')
        .setDescription('**Рейтинг чемпионов по тирам** (Emerald+)\n\nДанные: OP.GG | 38.6M анализов')
        .setImage('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png')
        .setFooter({ text: 'Обновляется каждую неделю | Данные: OP.GG' })
        .setTimestamp();

    // Добавляем тиры с картинками
    for (const [tier, champs] of Object.entries(LOL_TIER_LIST)) {
        const tierName = tier.replace('_', '+');
        const emoji = getTierEmoji(tierName);
        const value = champs.map(c => `${emoji} **${c}**`).join('\n');
        embed.addFields({ name: `━━━ ${tierName} TIER ━━━`, value, inline: true });
    }

    return embed;
}

// Создание embed для ТОП по позициям
function createTopChampionsEmbed(position) {
    const positionNames = { mid: 'Мид', adc: 'ADC', support: 'Поддержка', jungle: 'Джунгль', top: 'Топ' };
    const positionEmojis = { mid: '⚔️', adc: '🏹', support: '🛡', jungle: '🗡', top: '🛡' };
    const champions = LOL_CHAMPIONS[position];

    if (!champions) return null;

    const itemEmojis = {
        'Луден': '🟣', 'Светлячок': '🔵', 'Бездонная маска': '🟠',
        'Чертоги': '🟢', 'Сфера Void': '🔴', 'Пламя Рыцаря': '🟤',
        'Клятва Крушителя': '🟡', 'Танцующий меч': '⚪', 'Бесконечный голод': '🔵',
        'Доминик': '🔴', 'Смертельный танец': '⚫', 'Зимняя гора': '🟣',
        'Запредельная сила': '🟢', 'Воздаятель': '🔵', 'Медальон': '🟤',
        'Черный топор': '⚫', 'Костяной щит': '🟡', 'Джунгл предмет': '🟣',
        'Клятва': '🟡', 'Клинок': '⚪', 'Ледяной шлем': '🔵', 'Платье Рыцаря': '🟠'
    };

    const embeds = [];

    // Главный embed
    const mainEmbed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`${positionEmojis[position]} ТОП ЧЕМПИОНОВ — ${positionNames[position]}`)
        .setDescription('**Лучшие чемпионы по Win Rate** (Emerald+)')
        .setFooter({ text: 'Данные: OP.GG | Патч 16.13' })
        .setTimestamp();
    embeds.push(mainEmbed);

    // Каждый чемпион
    for (let i = 0; i < Math.min(champions.length, 5); i++) {
        const champ = champions[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

        const itemsText = champ.items.map(item => {
            const emoji = itemEmojis[item] || '⬛';
            return `${emoji} ${item}`;
        }).join(' → ');

        const champEmbed = new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle(`${medal} ${champ.name} — ${champ.tier} Tier`)
            .setDescription(`**Win Rate:** ${champ.winRate} | **Pick Rate:** ${champ.pickRate} | **Ban Rate:** ${champ.banRate}`)
            .addFields(
                { name: '🔮 Руна', value: champ.rune, inline: true },
                { name: '🛡 Сборка', value: itemsText, inline: false }
            )
            .setThumbnail(getChampionImage(champ.name));
        embeds.push(champEmbed);
    }

    return embeds;
}

// Создание сборок embed
function createBuildsEmbed(position) {
    const champions = LOL_CHAMPIONS[position];
    if (!champions) return null;

    const positionNames = { mid: 'Мид', adc: 'ADC', support: 'Поддержка', jungle: 'Джунгль', top: 'Топ' };
    const positionEmojis = { mid: '⚔️', adc: '🏹', support: '🛡', jungle: '🗡', top: '🛡' };

    const itemEmojis = {
        'Луден': '🟣', 'Светлячок': '🔵', 'Бездонная маска': '🟠',
        'Чертоги': '🟢', 'Сфера Void': '🔴', 'Пламя Рыцаря': '🟤',
        'Клятва Крушителя': '🟡', 'Танцующий меч': '⚪', 'Бесконечный голод': '🔵',
        'Доминик': '🔴', 'Смертельный танец': '⚫', 'Зимняя гора': '🟣',
        'Запредельная сила': '🟢', 'Воздаятель': '🔵', 'Медальон': '🟤',
        'Черный топор': '⚫', 'Костяной щит': '🟡', 'Джунгл предмет': '🟣',
        'Клятва': '🟡', 'Клинок': '⚪', 'Ледяной шлем': '🔵', 'Платье Рыцаря': '🟠'
    };

    const embeds = [];

    const mainEmbed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`${positionEmojis[position]} ТОП СБОРКИ — ${positionNames[position]}`)
        .setDescription('**Лучшие сборки по Win Rate** (Emerald+)')
        .setFooter({ text: 'Данные: OP.GG/U.GG | Патч 16.13' })
        .setTimestamp();
    embeds.push(mainEmbed);

    for (let i = 0; i < Math.min(champions.length, 3); i++) {
        const champ = champions[i];

        const itemsText = champ.items.map(item => {
            const emoji = itemEmojis[item] || '⬛';
            return `${emoji} ${item}`;
        }).join(' → ');

        const buildEmbed = new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle(`${getTierEmoji(champ.tier)} ${champ.name} — ${champ.tier} Tier`)
            .setDescription(`**Win Rate:** ${champ.winRate}`)
            .addFields(
                { name: '🔮 Руна', value: champ.rune, inline: true },
                { name: '🛡 Сборка', value: itemsText, inline: false }
            )
            .setThumbnail(getChampionImage(champ.name));
        embeds.push(buildEmbed);
    }

    return embeds;
}

// Создание рейтинга embed (КРАСИВО)
function createRatingEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🏆 РЕЙТИНГ ЧЕМПИОНОВ')
        .setDescription('**Топ-5 по позициям** (Win Rate)\n\nДанные: OP.GG | Emerald+')
        .setFooter({ text: 'Обновляется каждые 12 часов' })
        .setTimestamp();

    for (const [position, champions] of Object.entries(LOL_CHAMPIONS)) {
        const positionNames = { mid: '⚔️ Мид', adc: '🏹 ADC', support: '🛡 Поддержка', jungle: '🗡 Джунгль', top: '🛡 Топ' };
        const top5 = champions.slice(0, 5).map((c, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            return `${medal} **${c.name}** — ${c.winRate}`;
        }).join('\n');

        embed.addFields({ name: positionNames[position], value: top5, inline: true });
    }

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

// Функция получения LOL новостей
async function fetchLoLNews() {
    const allNews = [];
    for (const feed of LOL_RSS_FEEDS) {
        try {
            const data = await rssParser.parseURL(feed.url);
            const items = data.items.slice(0, 10).map(item => {
                // Извлекаем картинку из новости
                let image = null;
                if (item.enclosure?.url) {
                    image = item.enclosure.url;
                } else if (item['media:thumbnail']?.$?.url) {
                    image = item['media:thumbnail'].$.url;
                } else if (item['media:content']?.$?.url) {
                    image = item['media:content'].$.url;
                } else if (item.content) {
                    const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/);
                    if (imgMatch) image = imgMatch[1];
                }
                // Fallback: попробуем встроенные картинки из content:encoded
                if (!image && item['content:encoded']) {
                    const imgMatch = item['content:encoded'].match(/<img[^>]+src="([^"]+)"/);
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
            console.log('⚠️ LOL RSS ошибка:', feed.name, err.message);
        }
    }

    // Фильтруем только LOL-контент
    const lolNews = allNews.filter(item => isLoLContent(item.title, item.content));
    console.log(`🎮 LOL новостей после фильтрации: ${lolNews.length} из ${allNews.length}`);

    // Сортируем по дате (новые сверху)
    lolNews.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Берём топ 10 и переводим на русский
    const topNews = lolNews.slice(0, 10);
    for (const item of topNews) {
        item.title = await translateToRussian(item.title);
        item.content = await translateToRussian(item.content);
    }

    return topNews;
}

// Функция публикации новости в канал
async function postNewsToChannel(client) {
    try {
        // Ищем канал для общих игровых новостей (не LOL)
        for (const [, guild] of client.guilds.cache) {
            const newsChannel = guild.channels.cache.find(ch => 
                (ch.name.includes('igrovye') || ch.name.includes('igrovye-novosti') || ch.name.includes('igrovye-novosti') || ch.name.includes('игровые-новости')) && 
                !ch.name.includes('lol')
            );
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

function sanitizeText(text) {
    if (!text) return '';
    let c = text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').replace(/&[^;]+;/g, ' ');
    c = c.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return c.replace(/\s{2,}/g, ' ').trim().substring(0, 1000);
}

// Перевод текста на русский (через бесплатный API)
async function translateToRussian(text) {
    if (!text || text.length < 10) return text;

    const cleaned = sanitizeText(text);
    if (cleaned.length < 10) return cleaned;

    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const encodedText = encodeURIComponent(cleaned.substring(0, 500));
                const response = await fetch(
                    `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|ru&de=bot@discord.com`,
                    { signal: AbortSignal.timeout(8000) }
                );
                if (response.ok) {
                    const data = await response.json();
                    if (data.responseStatus === 200 && data.responseData?.translatedText) {
                        const translated = data.responseData.translatedText;
                        if (translated !== cleaned && !translated.includes('MYMEMORY WARNING')) {
                            return translated;
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    } catch (err) {
        console.error('⚠️ Ошибка перевода:', err.message);
    }

    return text;
}

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
    description: 'Создать категорию "🎮 ИГРОВЫЕ НОВОСТИ"',
    usage: '!gamenews',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ!');
        }

        const guild = message.guild;
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🎮 Создаю каналы...').setTimestamp()] });

        try {
            const category = await guild.channels.create({ name: '🎮 ИГРОВЫЕ НОВОСТИ', type: 4 });
            await new Promise(r => setTimeout(r, 1000));

            const ch1 = await guild.channels.create({ name: '📰-игровые-новости', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch2 = await guild.channels.create({ name: '🎮-lol-новости', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch3 = await guild.channels.create({ name: '⚔️-lol-гайды', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch4 = await guild.channels.create({ name: '💬-lol-команды', type: 0, parent: category });

            const everyone = guild.roles.everyone;
            const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
            const adminRole = guild.roles.cache.find(r => r.name === 'Admin');
            const modRole = guild.roles.cache.find(r => r.name === 'Moderator');

            // Каналы автопостинга - никто не пишет кроме.owner и Admin
            for (const ch of [ch1, ch2, ch3]) {
                await ch.permissionOverwrites.edit(everyone, { SendMessages: false });
                if (owner) await ch.permissionOverwrites.edit(owner, { SendMessages: true });
                if (adminRole) await ch.permissionOverwrites.edit(adminRole, { SendMessages: true });
            }

            // Канал команд - пишет только.owner, Admin, Moderator
            await ch4.permissionOverwrites.edit(everyone, { SendMessages: false });
            if (owner) await ch4.permissionOverwrites.edit(owner, { SendMessages: true });
            if (adminRole) await ch4.permissionOverwrites.edit(adminRole, { SendMessages: true });
            if (modRole) await ch4.permissionOverwrites.edit(modRole, { SendMessages: true });

            await new Promise(r => setTimeout(r, 2000));

            // Приветствия
            await ch1.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📰 ИГРОВЫЕ НОВОСТИ').setDescription('Последние новости из мира игр!\n\nGTA, Cyberpunk, Call of Duty и другие.\nПеревод на русский язык.\nАвто-обновление каждые 4 часа.').setTimestamp()] });
            await ch2.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('🎮 LOL НОВОСТИ').setDescription('Последние новости League of Legends!\n\nПатч-ноуты, новые чемпионы, скины.\nТурнирные новости.\nАвто-обновление.').setTimestamp()] });
            await ch3.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('⚔️ LOL ГАЙДЫ И СТАТИСТИКА').setDescription('Tier List, сборки, рейтинги!\n\nДанные: OP.GG | Патч 16.13\nАвто-обновление каждые 6-12 часов.').setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png').setTimestamp()] });
            await ch3.send({ embeds: [createTierListEmbed()] });
            await ch4.send({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('💬 LOL КОМАНДЫ').setDescription('Пишите команды здесь! Бот ответит.\n\n**Доступные команды:**\n`!tierlist` — Tier List\n`!top mid` — Топ чемпионов\n`!builds mid` — Сборки\n`!rating` — Рейтинг\n`!counter Ahri` — Статистика\n`!lolnews` — Новости\n`!lolhelp` — Подробная помощь').setTimestamp()] });

            await msg.edit({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('✅ Каналы созданы!').setDescription('📰-игровые-новости\n🎮-lol-новости\n⚔️-lol-гайды\n💬-lol-команды').setTimestamp()] });

        } catch (err) {
            console.error('❌ Ошибка gamenews:', err);
            await msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('❌ Ошибка').setDescription(err.message)] });
        }
    }
});

// --- ОТПРАВИТЬ В TELEGRAM ---

commands.set('tg', {
    name: 'tg',
    description: 'Отправить сообщение в Telegram',
    usage: '!tg [сообщение]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ!');
        }

        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            return message.reply('❌ Telegram не настроен! Добавь TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env');
        }

        const text = args.join(' ');
        if (!text) return message.reply('❌ Напиши сообщение: !tg Привет из Discord!');

        await sendToTelegram(text);
        message.reply('✅ Отправлено в Telegram!');
    }
});

// --- ОТПРАВИТЬ ПРИВЕТСТВИЯ ---

commands.set('postwelcome', {
    name: 'postwelcome',
    description: 'Отправить приветственные сообщения',
    usage: '!postwelcome',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ!');
        }

        const guild = message.guild;
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📢 Отправляю...').setTimestamp()] });

        // Получаем ВСЕ текстовые каналы
        const channels = guild.channels.cache.filter(ch => ch.type === 0);
        
        let sent = 0;

        for (const [, channel] of channels) {
            try {
                // Проверяем название канала
                const name = channel.name;
                
                if (name.includes('игровые') && name.includes('новости')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📰 ИГРОВЫЕ НОВОСТИ').setDescription('GTA, Cyberpunk, Call of Duty и другие игры!\nАвто-обновление каждые 4 часа.').setTimestamp()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('новости')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('🎮 LOL НОВОСТИ').setDescription('Патч-ноуты, скины, турниры!\nАвто-обновление.').setTimestamp()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('гайды')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('⚔️ LOL ГАЙДЫ').setDescription('Tier List, сборки, рейтинги!\nПишите команды в 💬-lol-команды').setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png').setTimestamp()] });
                    await channel.send({ embeds: [createTierListEmbed()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('команды')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('💬 LOL КОМАНДЫ').setDescription('Пишите команды здесь!\n\n!tierlist - Tier List\n!top mid - Топ чемпионов\n!builds mid - Сборки\n!rating - Рейтинг\n!counter Ahri - Статистика\n!lolnews - Новости').setTimestamp()] });
                    sent++;
                }
            } catch (err) {
                console.log('❌ Ошибка в канале', channel.name, err.message);
            }
        }

        await msg.edit({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle(`✅ Готово! Отправлено в ${sent} каналов`).setTimestamp()] });
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
    description: 'Tier List чемпионов по тирам',
    usage: '!tierlist',
    async execute(message) {
        const embed = createTierListEmbed();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('top', {
    name: 'top',
    description: 'Топ чемпионов по линии',
    usage: '!top [mid/adc/support/jungle/top]',
    async execute(message, args) {
        const position = args[0]?.toLowerCase();
        if (!position || !['mid', 'adc', 'support', 'jungle', 'top'].includes(position)) {
            return message.reply('❌ Укажи линию: `!top mid` `!top adc` `!top support` `!top jungle` `!top top`');
        }

        const embeds = createTopChampionsEmbed(position);
        if (embeds && embeds.length > 0) {
            // Discord позволяет отправить до 10 embed за раз
            for (let i = 0; i < embeds.length; i += 10) {
                await message.channel.send({ embeds: embeds.slice(i, i + 10) });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }
});

commands.set('builds', {
    name: 'builds',
    description: 'Топ сборки по позиции',
    usage: '!builds [mid/adc/support/jungle/top]',
    async execute(message, args) {
        const position = args[0]?.toLowerCase();
        if (!position || !['mid', 'adc', 'support', 'jungle', 'top'].includes(position)) {
            return message.reply('❌ Укажи позицию: `!builds mid` `!builds adc` `!builds support` `!builds jungle` `!builds top`');
        }

        const embeds = createBuildsEmbed(position);
        if (embeds && embeds.length > 0) {
            for (let i = 0; i < embeds.length; i += 10) {
                await message.channel.send({ embeds: embeds.slice(i, i + 10) });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
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
        if (!champ) return message.reply('❌ Укажи чемпиона: `!counter Ahri`');

        // Ищем чемпиона во всех позициях
        let foundChamp = null;
        for (const champions of Object.values(LOL_CHAMPIONS)) {
            foundChamp = champions.find(c => c.name.toLowerCase() === champ.toLowerCase());
            if (foundChamp) break;
        }

        if (!foundChamp) return message.reply('❌ Чемпион не найден! Попробуй: Ahri, Jinx, Thresh, Garen, Nasus');

        const embed = new EmbedBuilder()
            .setColor(getTierColor(foundChamp.tier))
            .setTitle(`${getTierEmoji(foundChamp.tier)} ${foundChamp.name}`)
            .setDescription(`**Статистика чемпиона** (Emerald+)`)
            .addFields(
                { name: '📊 Статистика', value: `**WR:** ${foundChamp.winRate} | **PR:** ${foundChamp.pickRate} | **BR:** ${foundChamp.banRate}`, inline: false },
                { name: '🔮 Руна', value: foundChamp.rune, inline: true },
                { name: '🛡 Сборка', value: foundChamp.items.join(' → '), inline: true }
            )
            .setThumbnail(getChampionImage(foundChamp.name))
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
                const translatedTitle = item.title;
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

// --- ПОМОЩЬ ПО LOL ---

commands.set('lolhelp', {
    name: 'lolhelp',
    description: 'Подробная помощь по LOL командам',
    usage: '!lolhelp',
    async execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('⚔️ ПОМОЩЬ ПО LEAGUE OF LEGENDS')
            .setDescription('Все команды для LOL с примерами:')
            .addFields(
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**📊 TIER LIST**', inline: false },
                { name: '`!tierlist`', value: 'Показать текущий Tier List чемпионов\nПример: `!tierlist`', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🛡 СБОРКИ**', inline: false },
                { name: '`!builds [позиция]`', value: 'Топ сборки по позиции\nПозиции: `mid` `adc` `support` `jungle` `top`\nПример: `!builds mid`', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🏆 РЕЙТИНГ**', inline: false },
                { name: '`!rating`', value: 'Рейтинг чемпионов по позициям\nПример: `!rating`', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**🛡 КОНТРЫ**', inline: false },
                { name: '`!counter [чемпион]`', value: 'Лучшие контры против чемпиона\nПример: `!counter Locke`', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**📰 НОВОСТИ**', inline: false },
                { name: '`!lolnews`', value: 'Новости LOL на русском языке с картинками\nИсточники: Surrender at 20, LoL Esports, LeagueFeed\nПример: `!lolnews`', inline: false },
                { name: '━━━━━━━━━━━━━━━━━━━', value: '**⏰ АВТО-ОБНОВЛЕНИЕ**', inline: false },
                { name: 'Tier List', value: 'Каждые 6 часов (09:00, 15:00, 21:00)', inline: true },
                { name: 'Сборки', value: 'Каждые 8 часов (10:00, 18:00)', inline: true },
                { name: 'Рейтинг', value: 'Каждые 12 часов (00:00, 12:00)', inline: true }
            )
            .setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png')
            .setFooter({ text: 'Данные: OP.GG | Все данные на русском языке' })
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
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
            .setFooter({ text: 'Бот: Зохан младший • Музыка: Jockie Music (m!play)' })
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
                { name: '`!dellolcommands`', value: 'Удалить канал lol-команды', inline: true },
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

// --- УДАЛИТЬ LOL КОМАНДЫ ---

commands.set('dellolcommands', {
    name: 'dellolcommands',
    description: 'Удалить канал lol-команды',
    usage: '!dellolcommands',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Только админ!');
        }

        const channel = message.guild.channels.cache.find(ch => ch.name.includes('lol-komandy') || ch.name.includes('lol-команды'));
        if (!channel) return message.reply('❌ Канал не найден!');

        await channel.delete().catch(() => {});
        message.reply('✅ Канал удалён!');
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
                { name: '🎵 Музыка', value: 'Используй `m!play` (Jockie Music бот)' },
                { name: '🎉 Розыгрыши', value: '`!giveaway`' },
                { name: '📊 Опросы', value: '`!poll`' },
                { name: '🎭 Роли', value: '`!reactrole` `!verify`' },
                { name: '⚙️ Сервер', value: '`!setup` `!rules` `!welcome` `!autorole` `!verify` `!commands` `!modcommands` `!help`' },
                { name: '🎮 Новости', value: '`!gamenews` `!news`' },
                { name: '⚔️ League of Legends', value: '`!tierlist` `!top` `!builds` `!rating` `!counter` `!lolnews` `!lolhelp`' },
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
    client.user.setActivity('!help | Сервер ZOHAN', { type: ActivityType.Playing });

    // Запуск Telegram бота (если настроен)
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
        console.log('✅ Telegram бот запущен!');

        // Обработка сообщений из Telegram → Discord
        telegramBot.on('message', async (msg) => {
            if (msg.from.is_bot) return;

            // Ищем канал для Telegram сообщений
            for (const [, guild] of client.guilds.cache) {
                const tgChannel = guild.channels.cache.find(ch =>
                    ch.name.includes('telegram') || ch.name.includes('tg')
                );
                if (tgChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x0099ff)
                        .setTitle('📱 Telegram')
                        .setDescription(`**${msg.from.first_name || msg.from.username}**: ${msg.text}`)
                        .setFooter({ text: 'Telegram → Discord' })
                        .setTimestamp();
                    await tgChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        });

        // Отправляем приветствие
        sendToTelegram('✅ Бот Discord запущен и связан с сервером!');
    }

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
        console.log(`⏰ Проверяю время: ${currentHour}:00`);

        // 🔴 Проверяем Twitch стримы каждые 5 минут
        await checkTwitchStreams(client);

        // 📰 Игровые новости
        if (newsHours.includes(currentHour)) {
            console.log('📰 Обновляю игровые новости...');
            await postNewsToChannel(client);
        }

        // 🎮 LOL новости (в канал lol-новости)
        if (newsHours.includes(currentHour)) {
            console.log('🎮 Обновляю LOL новости...');
            for (const [, guild] of client.guilds.cache) {
                const lolNewsChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-новости') || ch.name.includes('lol-novosti')
                );
                if (lolNewsChannel) {
                    console.log('🎮 Канал LOL новостей найден:', lolNewsChannel.name);
                    const lolNews = await fetchLoLNews();
                    console.log('🎮 Получено LOL новостей:', lolNews.length);
                    for (const item of lolNews) {
                        const embed = new EmbedBuilder()
                            .setColor(0xffd700)
                            .setTitle(`${item.emoji} ${item.title}`)
                            .setDescription(item.content.substring(0, 400) + (item.content.length > 400 ? '...' : ''))
                            .addFields(
                                { name: '📰 Источник', value: item.source, inline: true }
                            )
                            .setURL(item.link)
                            .setTimestamp();
                        if (item.image) {
                            try { embed.setImage(item.image); } catch (e) {}
                        }
                        await lolNewsChannel.send({ embeds: [embed] }).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                }
            }
        }

        // ⚔️ LOL Tier List (в канал lol-гайды)
        if (tierListHours.includes(currentHour)) {
            console.log('⚔️ Обновляю LOL Tier List...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-гайды') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('⚔️ Канал найден:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createTierListEmbed()] }).catch(() => {});
                }
            }
        }

        // 🛡 LOL Сборки (в канал lol-гайды)
        if (buildsHours.includes(currentHour)) {
            console.log('🛡 Обновляю LOL Сборки...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-гайды') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('🛡 Канал найден:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createBuildsEmbed('mid')] }).catch(() => {});
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await lolGuidesChannel.send({ embeds: [createBuildsEmbed('adc')] }).catch(() => {});
                }
            }
        }

        // 🏆 LOL Рейтинг (в канал lol-гайды)
        if (ratingHours.includes(currentHour)) {
            console.log('🏆 Обновляю LOL Рейтинг...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-гайды') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('🏆 Канал найден:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createRatingEmbed()] }).catch(() => {});
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
                { name: '🎮 Игровые новости', value: 'Загляни в канал **#🎮-новости** — там последние игровые новости!', inline: false },
                { name: '⚔️ LOL Гайды', value: 'Играешь в LOL? Смотри **#⚔️-lol-гайды** — Tier List, сборки, рейтинги!', inline: false },
                { name: '📜 Команды', value: 'Напиши `!help` чтобы узнать все команды бота!', inline: false },
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


const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/healthcheck' || url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK - Zohan Mimo Bot is running!');
        return;
    }

    // Эндпоинты для публикации новостей (вызываются cron-job.org)
    const endpoints = {
        '/post/gaming-news': () => postNewsToChannel(client),
        '/post/lol-news': async () => {
            for (const [, guild] of client.guilds.cache) {
                const ch = guild.channels.cache.find(c => c.name.includes('lol-новости') || c.name.includes('lol-novosti'));
                if (ch) {
                    const news = await fetchLoLNews();
                    const embeds = [];
                    for (const item of news) {
                        const newsId = item.source + '-' + item.title;
                        if (publishedLoLNews.has(newsId)) continue;
                        const embed = new EmbedBuilder()
                            .setColor(0xffd700)
                            .setTitle(item.emoji + ' ' + item.title)
                            .setDescription(item.content.substring(0, 400) + (item.content.length > 400 ? '...' : ''))
                            .addFields({ name: 'Источник', value: item.source, inline: true })
                            .setURL(item.link)
                            .setTimestamp();
                        if (item.image) { try { embed.setImage(item.image); } catch(e) {} }
                        embeds.push(embed);
                        publishedLoLNews.add(newsId);
                    }
                    for (let i = 0; i < embeds.length; i += 10) {
                        await ch.send({ embeds: embeds.slice(i, i + 10) }).catch(() => {});
                    }
                }
            }
        },
        '/post/tierlist': async () => {
            for (const [, guild] of client.guilds.cache) {
                const ch = guild.channels.cache.find(c => c.name.includes('lol-гайды') || c.name.includes('lol-gajdy'));
                if (ch) await ch.send({ embeds: [createTierListEmbed()] }).catch(() => {});
            }
        },
        '/post/builds': async () => {
            for (const [, guild] of client.guilds.cache) {
                const ch = guild.channels.cache.find(c => c.name.includes('lol-гайды') || c.name.includes('lol-gajdy'));
                if (ch) {
                    await ch.send({ embeds: createBuildsEmbed('mid') || [] }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2000));
                    await ch.send({ embeds: createBuildsEmbed('adc') || [] }).catch(() => {});
                }
            }
        },
        '/post/rating': async () => {
            for (const [, guild] of client.guilds.cache) {
                const ch = guild.channels.cache.find(c => c.name.includes('lol-гайды') || c.name.includes('lol-gajdy'));
                if (ch) await ch.send({ embeds: [createRatingEmbed()] }).catch(() => {});
            }
        }
    };

    if (endpoints[url]) {
        try {
            await endpoints[url]();
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK - Posted: ' + url);
            console.log('📰 Cron triggered: ' + url);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error: ' + err.message);
            console.error('❌ Cron error:', url, err.message);
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found. Available: /healthcheck, /post/gaming-news, /post/lol-news, /post/tierlist, /post/builds, /post/rating');
    }
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ HTTP-сервер запущен на порту ${PORT}`);
});

// ==================== Р—РђРџРЈРЎРљ ====================



// ==================== МИНИ-ИГРА: УГАДАЙ ЧЕМПИОНА ====================

// Все чемпионы Data Dragon для мини-игры
const ALL_CHAMPIONS = [
    'Ahri','Akali','Alistar','Amumu','Anivia','Annie','Ashe','Aurelion Sol','Azir',
    'Bard','Blitzcrank','Brand','Braum','Caitlyn','Camille','Cassiopeia','Cho Gath',
    'Corki','Darius','Diana','Dr Mundo','Draven','Ekko','Elise','Evelynn','Ezreal',
    'Fiddlesticks','Fiora','Fizz','Galio','Gangplank','Garen','Gragas','Graves',
    'Hecarim','Heimerdinger','Illaoi','Irelia','Ivern','Janna','Jarvan IV','Jax',
    'Jayce','Jhin','Jinx','Kai Sa','Kalista','Karma','Karthus','Kassadin','Katarina',
    'Kayle','Kayn','Kennen','Kha Zix','Kindred','Kled','Kog Maw','LeBlanc','Lee Sin',
    'Leona','Lillia','Lissandra','Lucian','Lulu','Lux','Malphite','Malzahar','Maokai',
    'Master Yi','Miss Fortune','Mordekaiser','Morgana','Nami','Nasus','Nautilus','Neeko',
    'Nidalee','Nocturne','Nunu and Willump','Olaf','Orianna','Ornn','Pantheon','Poppy',
    'Pyke','Qiyana','Quinn','Rakan','Rammus','Rek Sai','Renekton','Rengar','Riven',
    'Rumble','Ryze','Samira','Sejuani','Senna','Seraphine','Sett','Shaco','Shen',
    'Shyvana','Singed','Sion','Sivir','Skarner','Sona','Soraka','Swain','Sylas',
    'Syndra','Tahm Kench','Taliyah','Talon','Taric','Teemo','Thresh','Tristana',
    'Trundle','Tryndamere','Twisted Fate','Twitch','Urgot','Varus','Vayne','Veigar',
    'Vel Koz','Vi','Viktor','Vladimir','Volibear','Warwick','Wukong','Xayah','Xerath',
    'Xin Zhao','Yasuo','Yorick','Yuumi','Zac','Zed','Ziggs','Zilean','Zoe','Zyra'
];

// Активные игры (channelId -> game state)
const activeGames = new Map();

// Очки игроков (userId -> { wins, total })
const champScores = new Map();

// Загрузка/сохранение очков
const SCORES_FILE = __dirname + '/champ-scores.json';
function loadScores() {
    try {
        if (fs.existsSync(SCORES_FILE)) {
            const data = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
            for (const [k, v] of Object.entries(data)) champScores.set(k, v);
        }
    } catch (e) {}
}
function saveScores() {
    try {
        const data = Object.fromEntries(champScores);
        fs.writeFileSync(SCORES_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}
loadScores();

commands.set('champ', {
    name: 'champ',
    description: 'Мини-игра: Угадай чемпиона по картинке!',
    usage: '!champ',
    async execute(message) {
        if (activeGames.has(message.channel.id)) {
            return message.reply('⚠️ Уже идёт игра! Дождитесь окончания.');
        }

        // Выбираем случайного чемпиона
        const champion = ALL_CHAMPIONS[Math.floor(Math.random() * ALL_CHAMPIONS.length)];
        const champId = champion.replace(/[^a-zA-Z]/g, '');
        const imageUrl = `https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/${champId}.png`;

        // Начинаем игру
        activeGames.set(message.channel.id, {
            champion: champion.toLowerCase(),
            championName: champion,
            startedBy: message.author.id,
            startTime: Date.now(),
            hinted: false
        });

        const embed = new EmbedBuilder()
            .setColor(0xff6600)
            .setTitle('🎮 Угадай чемпиона!')
            .setDescription('Кто этот чемпион? Напиши имя в чат!\n\n⏱️ У вас **30 секунд**.')
            .setImage(imageUrl)
            .setFooter({ text: 'Напиши имя чемпиона в чат' })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });

        // Таймер 30 секунд
        setTimeout(() => {
            if (activeGames.has(message.channel.id)) {
                const game = activeGames.get(message.channel.id);
                activeGames.delete(message.channel.id);
                const timeUp = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('⏰ Время вышло!')
                    .setDescription(`Правильный ответ: **${game.championName}**`)
                    .setThumbnail(`https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/${game.championName.replace(/[^a-zA-Z]/g, '')}.png`);
                message.channel.send({ embeds: [timeUp] });
            }
        }, 30000);
    }
});

commands.set('champscores', {
    name: 'champscores',
    description: 'Таблица лидеров мини-игры "Угадай чемпиона"',
    usage: '!champscores',
    execute(message) {
        const scores = Array.from(champScores.entries())
            .sort((a, b) => b[1].wins - a[1].wins)
            .slice(0, 10);

        if (scores.length === 0) {
            return message.reply('Пока нет результатов. Сыграйте: !champ');
        }

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🏆 Таблица лидеров — Угадай чемпиона')
            .setDescription(scores.map((s, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                return `${medal} <@${s[0]}> — **${s[1].wins}** побед из ${s[1].total} игр`;
            }).join('\n'))
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// Обработка ответов в мини-игре
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.PREFIX || '!')) return;

    const game = activeGames.get(message.channel.id);
    if (!game) return;

    const guess = message.content.slice((process.env.PREFIX || '!').length).trim().toLowerCase();
    const cmd = guess.split(' ')[0];

    // Игнорируем команды бота
    if (commands.has(cmd)) return;

    if (guess === game.champion) {
        // Правильно!
        activeGames.delete(message.channel.id);

        const userId = message.author.id;
        if (!champScores.has(userId)) champScores.set(userId, { wins: 0, total: 0 });
        const score = champScores.get(userId);
        score.wins++;
        score.total++;
        saveScores();

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎉 Правильно!')
            .setDescription(`**${message.author.username}** угадал(а) — **${game.championName}**!`)
            .addFields(
                { name: '⏱️ Время', value: `${Math.round((Date.now() - game.startTime) / 1000)} сек.`, inline: true },
                { name: '🏆 Побед', value: `${score.wins}`, inline: true }
            )
            .setThumbnail(`https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/${game.championName.replace(/[^a-zA-Z]/g, '')}.png`)
            .setTimestamp();
        await message.channel.send({ embeds: [embed] });
    } else if (guess.length > 2 && !game.hinted && guess.length >= game.champion.length - 2) {
        // Подсказка: первая и последняя буква
        game.hinted = true;
        const hint = game.championName[0] + '*'.repeat(game.championName.length - 2) + game.championName[game.championName.length - 1];
        await message.reply(`💡 Подсказка: **${hint}** (${game.championName.length} букв)`);
    }
});


// ==================== СИСТЕМА УРОВНЕЙ / XP ====================

const XP_FILE = __dirname + '/xp-data.json';
const xpData = new Map();

// Загрузка XP данных
function loadXP() {
    try {
        if (fs.existsSync(XP_FILE)) {
            const data = JSON.parse(fs.readFileSync(XP_FILE, 'utf8'));
            for (const [k, v] of Object.entries(data)) xpData.set(k, v);
        }
    } catch (e) {}
}
function saveXP() {
    try {
        const data = Object.fromEntries(xpData);
        fs.writeFileSync(XP_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}
loadXP();

// XP за сообщение (5-15 рандомно)
const XP_PER_MESSAGE = { min: 5, max: 15 };

// Пороги уровней: level N требует N*100 XP
function getXPForLevel(level) {
    return level * 100;
}

function getLevelInfo(xp) {
    let level = 1;
    let remainingXP = xp;
    while (remainingXP >= getXPForLevel(level)) {
        remainingXP -= getXPForLevel(level);
        level++;
    }
    return { level, currentXP: remainingXP, nextLevelXP: getXPForLevel(level) };
}

function getRankEmoji(level) {
    if (level >= 50) return '👑';
    if (level >= 30) return '💎';
    if (level >= 20) return '🥇';
    if (level >= 10) return '🥈';
    if (level >= 5) return '🥉';
    return '⭐';
}

// Начисление XP за сообщение
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    if (!xpData.has(userId)) xpData.set(userId, { xp: 0, messages: 0, lastLevel: 1 });

    const userData = xpData.get(userId);
    const oldLevel = getLevelInfo(userData.xp).level;

    // Рандомный XP
    const xpGain = Math.floor(Math.random() * (XP_PER_MESSAGE.max - XP_PER_MESSAGE.min + 1)) + XP_PER_MESSAGE.min;
    userData.xp += xpGain;
    userData.messages++;

    const newInfo = getLevelInfo(userData.xp);

    // Уведомление о новом уровне
    if (newInfo.level > oldLevel) {
        userData.lastLevel = newInfo.level;
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`🎉 Новый уровень! ${getRankEmoji(newInfo.level)}`)
            .setDescription(`**${message.author.username}** достиг уровня **${newInfo.level}**!`)
            .addFields(
                { name: '📊 Всего XP', value: `${userData.xp}`, inline: true },
                { name: '💬 Сообщений', value: `${userData.messages}`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        await message.channel.send({ embeds: [embed] });
    }

    saveXP();
});

// Команда !level
commands.set('level', {
    name: 'level',
    description: 'Показать твой уровень и XP',
    usage: '!level [@user]',
    execute(message, args) {
        const user = message.mentions.users.first() || message.author;
        const userData = xpData.get(user.id) || { xp: 0, messages: 0 };
        const info = getLevelInfo(userData.xp);
        const emoji = getRankEmoji(info.level);
        const progress = Math.round((info.currentXP / info.nextLevelXP) * 100);

        // Прогресс-бар
        const filled = Math.round(progress / 10);
        const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`${emoji} Уровень ${info.level}`)
            .setDescription(`**${user.username}**`)
            .addFields(
                { name: '📊 XP', value: `${info.currentXP} / ${info.nextLevelXP}` , inline: true },
                { name: '💬 Сообщений', value: `${userData.messages}`, inline: true },
                { name: 'Прогресс', value: bar + ' (' + progress + '%)' }
            )
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// Команда !leaderboard
commands.set('leaderboard', {
    name: 'leaderboard',
    description: 'Таблица лидеров по уровням',
    usage: '!leaderboard',
    execute(message) {
        const sorted = Array.from(xpData.entries())
            .sort((a, b) => b[1].xp - a[1].xp)
            .slice(0, 10);

        if (sorted.length === 0) {
            return message.reply('Пока нет данных. Пишите в чат чтобы набирать XP!');
        }

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🏆 Таблица лидеров')
            .setDescription(sorted.map((s, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const info = getLevelInfo(s[1].xp);
                const emoji = getRankEmoji(info.level);
                return `${medal} <@${s[0]}> — ${emoji} Ур. **${info.level}** (${s[1].xp} XP)`;
            }).join('\n'))
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// Команда !rank (быстрая проверка)
commands.set('rank', {
    name: 'rank',
    description: 'Быстро проверить свой уровень',
    usage: '!rank',
    execute(message) {
        const userData = xpData.get(message.author.id) || { xp: 0, messages: 0 };
        const info = getLevelInfo(userData.xp);
        const emoji = getRankEmoji(info.level);
        message.reply(`${emoji} Уровень **${info.level}** | **${userData.xp}** XP | **${userData.messages}** сообщений`);
    }
});

client.login(process.env.TOKEN);
