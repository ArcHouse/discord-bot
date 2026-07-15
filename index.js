const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType, ChannelType } = require('discord.js');
const RSSParser = require('rss-parser');
const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');

dotenv.config();
// Настройки сервера (сохраняются между перезапусками)
const path = require('path');
const CONFIG_FILE = path.join(__dirname, 'server-config.json');
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (data.WELCOME_CHANNEL) process.env.WELCOME_CHANNEL = data.WELCOME_CHANNEL;
            if (data.AUTOROLE) process.env.AUTOROLE = data.AUTOROLE;
            console.log('✅ Конфигурация загружена:', data);
        }
    } catch (err) {
        console.log('⚠️ Ошибка загрузки конфига:', err.message);
    }
}
function saveConfig() {
    try {
        const data = {};
        if (process.env.WELCOME_CHANNEL) data.WELCOME_CHANNEL = process.env.WELCOME_CHANNEL;
        if (process.env.AUTOROLE) data.AUTOROLE = process.env.AUTOROLE;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log('✅ Конфигурация сохранена:', data);
    } catch (err) {
        console.log('⚠️ Ошибка сохранения конфига:', err.message);
    }
}
loadConfig();


// РђРЅС‚РёСЃРїР°Рј С…СЂР°РЅРёР»РёС‰Рµ
const spamTracker = new Map();
const SPAM_LIMIT = 30;
const SPAM_TIME = 10000;

// РќР°СЃС‚СЂРѕР№РєР° РїСЂРѕРєСЃРё РµСЃР»Рё СѓРєР°Р·Р°РЅ
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

// Р•СЃР»Рё СѓРєР°Р·Р°РЅ РїСЂРѕРєСЃРё - РґРѕР±Р°РІР»СЏРµРј РїРѕРґРґРµСЂР¶РєСѓ
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
    console.log(`рџ”— РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РїСЂРѕРєСЃРё: ${process.env.PROXY}`);
}

const client = new Client(clientOptions);

// ==================== TELEGRAM BOT ====================

// Telegram Р±РѕС‚ РґР»СЏ СЃРІСЏР·Рё Discord в†” Telegram
let telegramBot = null;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Р¤СѓРЅРєС†РёСЏ РѕС‚РїСЂР°РІРєРё СЃРѕРѕР±С‰РµРЅРёСЏ РІ Telegram
async function sendToTelegram(message, fromDiscord = true) {
    if (!telegramBot || !TELEGRAM_CHAT_ID) return;

    try {
        const prefix = fromDiscord ? 'рџ’¬ Discord: ' : '';
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, prefix + message);
    } catch (err) {
        console.log('вљ пёЏ Telegram РѕС€РёР±РєР°:', err.message);
    }
}

// Р¤СѓРЅРєС†РёСЏ РѕС‚РїСЂР°РІРєРё embed РІ Telegram
async function sendEmbedToTelegram(embed, fromDiscord = true) {
    if (!telegramBot || !TELEGRAM_CHAT_ID) return;

    try {
        const prefix = fromDiscord ? 'рџ’¬ Discord:\n' : '';
        let text = prefix + embed.title + '\n\n';
        if (embed.description) text += embed.description + '\n';
        if (embed.fields) {
            embed.fields.forEach(f => {
                text += `\n${f.name}: ${f.value}`;
            });
        }
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, text.substring(0, 4000));
    } catch (err) {
        console.log('вљ пёЏ Telegram embed РѕС€РёР±РєР°:', err.message);
    }
}

// ==================== РР“Р РћР’Р«Р• РќРћР’РћРЎРўР ====================

const rssParser = new RSSParser();

// RSS-Р»РµРЅС‚С‹ РёРіСЂРѕРІС‹С… РЅРѕРІРѕСЃС‚РµР№ (С‚РѕР»СЊРєРѕ СЂР°Р±РѕС‡РёРµ!)
const RSS_FEEDS = [
    {
        name: 'PC Gamer',
        url: 'https://www.pcgamer.com/rss/',
        emoji: 'рџ–ҐпёЏ'
    },
    {
        name: 'Eurogamer',
        url: 'https://www.eurogamer.net/feed',
        emoji: 'рџЋ®'
    },
    {
        name: 'Rock Paper Shotgun',
        url: 'https://www.rockpapershotgun.com/feed',
        emoji: 'рџ“°'
    },
    {
        name: 'VG247',
        url: 'https://www.vg247.com/feed',
        emoji: 'рџЋЇ'
    },
    {
        name: 'GamesIndustry',
        url: 'https://www.gamesindustry.biz/feed',
        emoji: 'рџ“Љ'
    }
];

// LOL RSS-Р»РµРЅС‚С‹ (С‚РѕР»СЊРєРѕ LOL-СЃРїРµС†РёС„РёС‡РЅС‹Рµ РёСЃС‚РѕС‡РЅРёРєРё)
const LOL_RSS_FEEDS = [
    {
        name: 'Surrender at 20',
        url: 'https://www.surrenderat20.net/feeds/posts/default?alt=rss',
        emoji: 'рџ“°',
        lolOnly: true
    },
    {
        name: 'LoL Esports',
        url: 'https://lolesports.com/rss',
        emoji: 'рџЏ†',
        lolOnly: true
    },
    {
        name: 'LeagueFeed',
        url: 'https://www.leaguefeed.net/feed',
        emoji: 'рџЋ®',
        lolOnly: true
    }
];

// РљР»СЋС‡РµРІС‹Рµ СЃР»РѕРІР° LOL РґР»СЏ С„РёР»СЊС‚СЂР°С†РёРё РєРѕРЅС‚РµРЅС‚Р°
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

// РџСЂРѕРІРµСЂРєР° СЏРІР»СЏРµС‚СЃСЏ Р»Рё С‚РµРєСЃС‚ Рѕ League of Legends
function isLoLContent(title, content) {
    const text = (title + ' ' + content).toLowerCase();
    return LOL_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

// РҐСЂР°РЅРёР»РёС‰Рµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹С… РЅРѕРІРѕСЃС‚РµР№ (С‡С‚РѕР±С‹ РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ)
const publishedNews = new Set();
const publishedLoLNews = new Set();

// ==================== LOL Р”РђРќРќР«Р• (OP.GG РЈР РћР’Р•РќР¬) ====================

// Tier List
const LOL_TIER_LIST = {
    S_plus: ['Ahri', 'Jinx', 'Senna'],
    S: ['Thresh', 'Leona', 'Fizz', 'Katarina'],
    A: ['Syndra', 'Viktor', 'Xerath', 'Nasus', 'Garen'],
    B: ['Malphite', 'Shen', 'Ornn', 'Diana', 'Lissandra']
};

// Р РµР°Р»СЊРЅР°СЏ СЃС‚Р°С‚РёСЃС‚РёРєР° С‡РµРјРїРёРѕРЅРѕРІ СЃ OP.GG
const LOL_CHAMPIONS = {
    // РњРР”
    mid: [
        { name: 'Ahri', winRate: '51.01%', pickRate: '9.02%', banRate: '3.13%', tier: 'S', rune: 'РўР°Р№РЅС‹Р№ РѕРіРѕРЅСЊ', items: ['Р›СѓРґРµРЅ', 'РЎРІРµС‚Р»СЏС‡РѕРє', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] },
        { name: 'Syndra', winRate: '50.88%', pickRate: '7.46%', banRate: '4.73%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'Р§РµСЂС‚РѕРіРё', 'РЎС„РµСЂР° Void'] },
        { name: 'Viktor', winRate: '50.42%', pickRate: '8.62%', banRate: '8.16%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'Р§РµСЂС‚РѕРіРё', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] },
        { name: 'Xerath', winRate: '51.65%', pickRate: '4.61%', banRate: '8.07%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РЎРІРµС‚Р»СЏС‡РѕРє', 'Р§РµСЂС‚РѕРіРё'] },
        { name: 'Fizz', winRate: '51.56%', pickRate: '5.22%', banRate: '6.37%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] },
        { name: 'Katarina', winRate: '51.15%', pickRate: '6.82%', banRate: '9.99%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] },
        { name: 'Diana', winRate: '51.47%', pickRate: '4.36%', banRate: '4.87%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] },
        { name: 'Lissandra', winRate: '51.12%', pickRate: '5.1%', banRate: '3.05%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РЎРІРµС‚Р»СЏС‡РѕРє', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] }
    ],
    // ADC
    adc: [
        { name: 'Jinx', winRate: '51.97%', pickRate: '11.42%', banRate: '2.25%', tier: 'S+', rune: 'Р¤Р°С‚Р°Р»СЊРЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ', items: ['РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ', 'РўР°РЅС†СѓСЋС‰РёР№ РјРµС‡', 'Р‘РµСЃРєРѕРЅРµС‡РЅС‹Р№ РіРѕР»РѕРґ'] },
        { name: 'Senna', winRate: '53.4%', pickRate: '8.89%', banRate: '22.19%', tier: 'S+', rune: 'РљР»СЏС‚РІР°', items: ['РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ', 'Р”РѕРјРёРЅРёРє', 'РЎРјРµСЂС‚РµР»СЊРЅС‹Р№ С‚Р°РЅРµС†'] },
        { name: 'Tristana', winRate: '51.32%', pickRate: '7.17%', banRate: '2.53%', tier: 'A', rune: 'Р¤Р°С‚Р°Р»СЊРЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ', items: ['РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ', 'РўР°РЅС†СѓСЋС‰РёР№ РјРµС‡', 'Р‘РµСЃРєРѕРЅРµС‡РЅС‹Р№ РіРѕР»РѕРґ'] },
        { name: 'Seraphine', winRate: '53.89%', pickRate: '3.02%', banRate: '11.62%', tier: 'S+', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р›СѓРґРµРЅ', 'РЎРІРµС‚Р»СЏС‡РѕРє', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] }
    ],
    // РџРћР”Р”Р•Р Р–РљРђ
    support: [
        { name: 'Thresh', winRate: '51.85%', pickRate: '13.54%', banRate: '8.09%', tier: 'S+', rune: 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'Р’РѕР·РґР°СЏС‚РµР»СЊ'] },
        { name: 'Leona', winRate: '52.12%', pickRate: '7.49%', banRate: '6.85%', tier: 'S', rune: 'РђС„РµСЂР°', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РњРµРґР°Р»СЊРѕРЅ'] },
        { name: 'Nautilus', winRate: '50.47%', pickRate: '10.47%', banRate: '13.89%', tier: 'A', rune: 'РђС„РµСЂР°', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РњРµРґР°Р»СЊРѕРЅ'] },
        { name: 'Braum', winRate: '51.86%', pickRate: '4.54%', banRate: '5.5%', tier: 'A', rune: 'РђС„РµСЂР°', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РњРµРґР°Р»СЊРѕРЅ'] },
        { name: 'Sona', winRate: '52.05%', pickRate: '3%', banRate: '0.2%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РњРµРґР°Р»СЊРѕРЅ'] }
    ],
    // Р”Р–РЈРќР“Р›Р¬
    jungle: [
        { name: 'Nasus', winRate: '53.12%', pickRate: '3.57%', banRate: '7.1%', tier: 'S+', rune: 'Р“СЂР°РґРёРµРЅС‚', items: ['Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚', 'Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚'] },
        { name: 'Nocturne', winRate: '51.57%', pickRate: '7.23%', banRate: '12.87%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚', 'РљР»СЏС‚РІР°', 'РљР»РёРЅРѕРє'] },
        { name: 'Wukong', winRate: '51.98%', pickRate: '5.79%', banRate: '1.97%', tier: 'S', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚', 'РљР»СЏС‚РІР°', 'РљР»РёРЅРѕРє'] },
        { name: 'Briar', winRate: '51.67%', pickRate: '4.91%', banRate: '8.23%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚', 'РљР»СЏС‚РІР°', 'РљР»РёРЅРѕРє'] },
        { name: 'Sylas', winRate: '50.46%', pickRate: '8.48%', banRate: '18.66%', tier: 'A', rune: 'Р­Р»РµРєС‚СЂРѕС€РѕРє', items: ['Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚', 'Р›СѓРґРµРЅ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°'] }
    ],
    // РўРћРџ
    top: [
        { name: 'Garen', winRate: '51.76%', pickRate: '8.16%', banRate: '6.9%', tier: 'S', rune: 'РљРѕРЅРєРёСЃС‚Р°РґРѕСЂ', items: ['Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚', 'РњРµРґР°Р»СЊРѕРЅ'] },
        { name: 'Malphite', winRate: '51.34%', pickRate: '7.01%', banRate: '17.88%', tier: 'S', rune: 'РђС„РµСЂР°', items: ['Р›РµРґСЏРЅРѕР№ С€Р»РµРј', 'РџР»Р°С‚СЊРµ Р С‹С†Р°СЂСЏ', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚'] },
        { name: 'Kayle', winRate: '52.02%', pickRate: '2.52%', banRate: '2.34%', tier: 'A', rune: 'РљРѕРЅРєРёСЃС‚Р°РґРѕСЂ', items: ['Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚', 'РњРµРґР°Р»СЊРѕРЅ'] },
        { name: 'Shen', winRate: '51.65%', pickRate: '4.02%', banRate: '0.95%', tier: 'A', rune: 'РђС„РµСЂР°', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚'] },
        { name: 'Ornn', winRate: '51.33%', pickRate: '3.79%', banRate: '0.61%', tier: 'A', rune: 'РђС„РµСЂР°', items: ['Р—РёРјРЅСЏСЏ РіРѕСЂР°', 'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚'] }
    ]
};

// РљР°СЂС‚РёРЅРєРё С‡РµРјРїРёРѕРЅРѕРІ (Riot Data Dragon - СЂР°Р±РѕС‚Р°РµС‚!)
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

// РљР°СЂС‚РёРЅРєРё РїСЂРµРґРјРµС‚РѕРІ (Riot Data Dragon)
function getItemImage(itemName) {
    const items = {
        'Р›СѓРґРµРЅ': '3285',        // Luden's Tempest
        'РЎРІРµС‚Р»СЏС‡РѕРє': '4628',    // Horizon Focus
        'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°': '4645', // Shadowflame
        'Р§РµСЂС‚РѕРіРё': '4637',      // Cryptbloom
        'РЎС„РµСЂР° Void': '3135',   // Void Staff
        'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ': '3142', // Youmuu's Ghostblade
        'РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ': '3153', // Immortal Shieldbow
        'РўР°РЅС†СѓСЋС‰РёР№ РјРµС‡': '3124', // Guinsoo's Rageblade
        'Р‘РµСЃРєРѕРЅРµС‡РЅС‹Р№ РіРѕР»РѕРґ': '3031', // Infinity Edge
        'Р”РѕРјРёРЅРёРє': '3036',      // Lord Dominik's Regards
        'РЎРјРµСЂС‚РµР»СЊРЅС‹Р№ С‚Р°РЅРµС†': '3156', // Death's Dance
        'Р—РёРјРЅСЏСЏ РіРѕСЂР°': '3857',  // Steel Shoulderguards
        'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°': '3190', // Locket of the Iron Solari
        'Р’РѕР·РґР°СЏС‚РµР»СЊ': '3107',   // Redemption
        'РњРµРґР°Р»СЊРѕРЅ': '3190',     // Locket
        'Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ': '3071', // Black Cleaver
        'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚': '3068', // Sunfire Aegis
        'Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚': '1101', // Hailblade
        'РљР»СЏС‚РІР°': '3153',       // Immortal Shieldbow
        'РљР»РёРЅРѕРє': '3134',       // Serrated Dirk
        'Р›РµРґСЏРЅРѕР№ С€Р»РµРј': '3116', // Rylai's Crystal Scepter
        'РџР»Р°С‚СЊРµ Р С‹С†Р°СЂСЏ': '3157' // Zhonya's Hourglass
    };
    const itemId = items[itemName] || '1001'; // Default boot if not found
    return `https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/${itemId}.png`;
}

// РўIER EMOJI
function getTierEmoji(tier) {
    const emojis = { 'S+': 'рџЏ†', 'S': 'рџҐ‡', 'A': 'рџҐ€', 'B': 'рџҐ‰', 'C': 'рџ“Љ' };
    return emojis[tier] || 'рџ“Љ';
}

// TIER COLOR
function getTierColor(tier) {
    const colors = { 'S+': 0xffd700, 'S': 0xff6600, 'A': 0x00ff00, 'B': 0x0099ff, 'C': 0x999999 };
    return colors[tier] || 0x5865f2;
}

// РЎРѕР·РґР°РЅРёРµ Tier List embed (РљР РђРЎРР’Рћ РЎ РљРђР РўРРќРљРђРњР)
function createTierListEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('рџ“Љ TIER LIST вЂ” РџР°С‚С‡ 16.13')
        .setDescription('**Р РµР№С‚РёРЅРі С‡РµРјРїРёРѕРЅРѕРІ РїРѕ С‚РёСЂР°Рј** (Emerald+)\n\nР”Р°РЅРЅС‹Рµ: OP.GG | 38.6M Р°РЅР°Р»РёР·РѕРІ')
        .setImage('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png')
        .setFooter({ text: 'РћР±РЅРѕРІР»СЏРµС‚СЃСЏ РєР°Р¶РґСѓСЋ РЅРµРґРµР»СЋ | Р”Р°РЅРЅС‹Рµ: OP.GG' })
        .setTimestamp();

    // Р”РѕР±Р°РІР»СЏРµРј С‚РёСЂС‹ СЃ РєР°СЂС‚РёРЅРєР°РјРё
    for (const [tier, champs] of Object.entries(LOL_TIER_LIST)) {
        const tierName = tier.replace('_', '+');
        const emoji = getTierEmoji(tierName);
        const value = champs.map(c => `${emoji} **${c}**`).join('\n');
        embed.addFields({ name: `в”Ѓв”Ѓв”Ѓ ${tierName} TIER в”Ѓв”Ѓв”Ѓ`, value, inline: true });
    }

    return embed;
}

// РЎРѕР·РґР°РЅРёРµ embed РґР»СЏ РўРћРџ РїРѕ РїРѕР·РёС†РёСЏРј
function createTopChampionsEmbed(position) {
    const positionNames = { mid: 'РњРёРґ', adc: 'ADC', support: 'РџРѕРґРґРµСЂР¶РєР°', jungle: 'Р”Р¶СѓРЅРіР»СЊ', top: 'РўРѕРї' };
    const positionEmojis = { mid: 'вљ”пёЏ', adc: 'рџЏ№', support: 'рџ›Ў', jungle: 'рџ—Ў', top: 'рџ›Ў' };
    const champions = LOL_CHAMPIONS[position];

    if (!champions) return null;

    const itemEmojis = {
        'Р›СѓРґРµРЅ': 'рџџЈ', 'РЎРІРµС‚Р»СЏС‡РѕРє': 'рџ”µ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°': 'рџџ ',
        'Р§РµСЂС‚РѕРіРё': 'рџџў', 'РЎС„РµСЂР° Void': 'рџ”ґ', 'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ': 'рџџ¤',
        'РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ': 'рџџЎ', 'РўР°РЅС†СѓСЋС‰РёР№ РјРµС‡': 'вљЄ', 'Р‘РµСЃРєРѕРЅРµС‡РЅС‹Р№ РіРѕР»РѕРґ': 'рџ”µ',
        'Р”РѕРјРёРЅРёРє': 'рџ”ґ', 'РЎРјРµСЂС‚РµР»СЊРЅС‹Р№ С‚Р°РЅРµС†': 'вљ«', 'Р—РёРјРЅСЏСЏ РіРѕСЂР°': 'рџџЈ',
        'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°': 'рџџў', 'Р’РѕР·РґР°СЏС‚РµР»СЊ': 'рџ”µ', 'РњРµРґР°Р»СЊРѕРЅ': 'рџџ¤',
        'Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ': 'вљ«', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚': 'рџџЎ', 'Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚': 'рџџЈ',
        'РљР»СЏС‚РІР°': 'рџџЎ', 'РљР»РёРЅРѕРє': 'вљЄ', 'Р›РµРґСЏРЅРѕР№ С€Р»РµРј': 'рџ”µ', 'РџР»Р°С‚СЊРµ Р С‹С†Р°СЂСЏ': 'рџџ '
    };

    const embeds = [];

    // Р“Р»Р°РІРЅС‹Р№ embed
    const mainEmbed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`${positionEmojis[position]} РўРћРџ Р§Р•РњРџРРћРќРћР’ вЂ” ${positionNames[position]}`)
        .setDescription('**Р›СѓС‡С€РёРµ С‡РµРјРїРёРѕРЅС‹ РїРѕ Win Rate** (Emerald+)')
        .setFooter({ text: 'Р”Р°РЅРЅС‹Рµ: OP.GG | РџР°С‚С‡ 16.13' })
        .setTimestamp();
    embeds.push(mainEmbed);

    // РљР°Р¶РґС‹Р№ С‡РµРјРїРёРѕРЅ
    for (let i = 0; i < Math.min(champions.length, 5); i++) {
        const champ = champions[i];
        const medal = i === 0 ? 'рџҐ‡' : i === 1 ? 'рџҐ€' : i === 2 ? 'рџҐ‰' : `${i + 1}.`;

        const itemsText = champ.items.map(item => {
            const emoji = itemEmojis[item] || 'в¬›';
            return `${emoji} ${item}`;
        }).join(' в†’ ');

        const champEmbed = new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle(`${medal} ${champ.name} вЂ” ${champ.tier} Tier`)
            .setDescription(`**Win Rate:** ${champ.winRate} | **Pick Rate:** ${champ.pickRate} | **Ban Rate:** ${champ.banRate}`)
            .addFields(
                { name: 'рџ”® Р СѓРЅР°', value: champ.rune, inline: true },
                { name: 'рџ›Ў РЎР±РѕСЂРєР°', value: itemsText, inline: false }
            )
            .setThumbnail(getChampionImage(champ.name));
        embeds.push(champEmbed);
    }

    return embeds;
}

// РЎРѕР·РґР°РЅРёРµ СЃР±РѕСЂРѕРє embed
function createBuildsEmbed(position) {
    const champions = LOL_CHAMPIONS[position];
    if (!champions) return null;

    const positionNames = { mid: 'РњРёРґ', adc: 'ADC', support: 'РџРѕРґРґРµСЂР¶РєР°', jungle: 'Р”Р¶СѓРЅРіР»СЊ', top: 'РўРѕРї' };
    const positionEmojis = { mid: 'вљ”пёЏ', adc: 'рџЏ№', support: 'рџ›Ў', jungle: 'рџ—Ў', top: 'рџ›Ў' };

    const itemEmojis = {
        'Р›СѓРґРµРЅ': 'рџџЈ', 'РЎРІРµС‚Р»СЏС‡РѕРє': 'рџ”µ', 'Р‘РµР·РґРѕРЅРЅР°СЏ РјР°СЃРєР°': 'рџџ ',
        'Р§РµСЂС‚РѕРіРё': 'рџџў', 'РЎС„РµСЂР° Void': 'рџ”ґ', 'РџР»Р°РјСЏ Р С‹С†Р°СЂСЏ': 'рџџ¤',
        'РљР»СЏС‚РІР° РљСЂСѓС€РёС‚РµР»СЏ': 'рџџЎ', 'РўР°РЅС†СѓСЋС‰РёР№ РјРµС‡': 'вљЄ', 'Р‘РµСЃРєРѕРЅРµС‡РЅС‹Р№ РіРѕР»РѕРґ': 'рџ”µ',
        'Р”РѕРјРёРЅРёРє': 'рџ”ґ', 'РЎРјРµСЂС‚РµР»СЊРЅС‹Р№ С‚Р°РЅРµС†': 'вљ«', 'Р—РёРјРЅСЏСЏ РіРѕСЂР°': 'рџџЈ',
        'Р—Р°РїСЂРµРґРµР»СЊРЅР°СЏ СЃРёР»Р°': 'рџџў', 'Р’РѕР·РґР°СЏС‚РµР»СЊ': 'рџ”µ', 'РњРµРґР°Р»СЊРѕРЅ': 'рџџ¤',
        'Р§РµСЂРЅС‹Р№ С‚РѕРїРѕСЂ': 'вљ«', 'РљРѕСЃС‚СЏРЅРѕР№ С‰РёС‚': 'рџџЎ', 'Р”Р¶СѓРЅРіР» РїСЂРµРґРјРµС‚': 'рџџЈ',
        'РљР»СЏС‚РІР°': 'рџџЎ', 'РљР»РёРЅРѕРє': 'вљЄ', 'Р›РµРґСЏРЅРѕР№ С€Р»РµРј': 'рџ”µ', 'РџР»Р°С‚СЊРµ Р С‹С†Р°СЂСЏ': 'рџџ '
    };

    const embeds = [];

    const mainEmbed = new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(`${positionEmojis[position]} РўРћРџ РЎР‘РћР РљР вЂ” ${positionNames[position]}`)
        .setDescription('**Р›СѓС‡С€РёРµ СЃР±РѕСЂРєРё РїРѕ Win Rate** (Emerald+)')
        .setFooter({ text: 'Р”Р°РЅРЅС‹Рµ: OP.GG/U.GG | РџР°С‚С‡ 16.13' })
        .setTimestamp();
    embeds.push(mainEmbed);

    for (let i = 0; i < Math.min(champions.length, 3); i++) {
        const champ = champions[i];

        const itemsText = champ.items.map(item => {
            const emoji = itemEmojis[item] || 'в¬›';
            return `${emoji} ${item}`;
        }).join(' в†’ ');

        const buildEmbed = new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle(`${getTierEmoji(champ.tier)} ${champ.name} вЂ” ${champ.tier} Tier`)
            .setDescription(`**Win Rate:** ${champ.winRate}`)
            .addFields(
                { name: 'рџ”® Р СѓРЅР°', value: champ.rune, inline: true },
                { name: 'рџ›Ў РЎР±РѕСЂРєР°', value: itemsText, inline: false }
            )
            .setThumbnail(getChampionImage(champ.name));
        embeds.push(buildEmbed);
    }

    return embeds;
}

// РЎРѕР·РґР°РЅРёРµ СЂРµР№С‚РёРЅРіР° embed (РљР РђРЎРР’Рћ)
function createRatingEmbed() {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('рџЏ† Р Р•Р™РўРРќР“ Р§Р•РњРџРРћРќРћР’')
        .setDescription('**РўРѕРї-5 РїРѕ РїРѕР·РёС†РёСЏРј** (Win Rate)\n\nР”Р°РЅРЅС‹Рµ: OP.GG | Emerald+')
        .setFooter({ text: 'РћР±РЅРѕРІР»СЏРµС‚СЃСЏ РєР°Р¶РґС‹Рµ 12 С‡Р°СЃРѕРІ' })
        .setTimestamp();

    for (const [position, champions] of Object.entries(LOL_CHAMPIONS)) {
        const positionNames = { mid: 'вљ”пёЏ РњРёРґ', adc: 'рџЏ№ ADC', support: 'рџ›Ў РџРѕРґРґРµСЂР¶РєР°', jungle: 'рџ—Ў Р”Р¶СѓРЅРіР»СЊ', top: 'рџ›Ў РўРѕРї' };
        const top5 = champions.slice(0, 5).map((c, i) => {
            const medal = i === 0 ? 'рџҐ‡' : i === 1 ? 'рџҐ€' : i === 2 ? 'рџҐ‰' : `${i + 1}.`;
            return `${medal} **${c.name}** вЂ” ${c.winRate}`;
        }).join('\n');

        embed.addFields({ name: positionNames[position], value: top5, inline: true });
    }

    return embed;
}

// Р¤СѓРЅРєС†РёСЏ РїРѕР»СѓС‡РµРЅРёСЏ РЅРѕРІРѕСЃС‚РµР№
async function fetchGameNews() {
    const allNews = [];

    for (const feed of RSS_FEEDS) {
        try {
            const data = await rssParser.parseURL(feed.url);
            const items = data.items.slice(0, 5).map(item => {
                // РР·РІР»РµРєР°РµРј РєР°СЂС‚РёРЅРєСѓ РёР· РЅРѕРІРѕСЃС‚Рё
                let image = null;

                // РџСЂРѕРІРµСЂСЏРµРј СЂР°Р·РЅС‹Рµ РёСЃС‚РѕС‡РЅРёРєРё РєР°СЂС‚РёРЅРѕРє РІ RSS
                if (item.enclosure?.url) {
                    image = item.enclosure.url;
                } else if (item['media:thumbnail']?.$?.url) {
                    image = item['media:thumbnail'].$.url;
                } else if (item['media:content']?.$?.url) {
                    image = item['media:content'].$.url;
                } else if (item.content) {
                    // РџСЂРѕР±СѓРµРј РёР·РІР»РµС‡СЊ РєР°СЂС‚РёРЅРєСѓ РёР· HTML РєРѕРЅС‚РµРЅС‚Р°
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
            console.error(`вќЊ РћС€РёР±РєР° RSS ${feed.name}:`, err.message);
        }
    }

    // РЎРѕСЂС‚РёСЂСѓРµРј РїРѕ РґР°С‚Рµ (РЅРѕРІС‹Рµ СЃРІРµСЂС…Сѓ)
    allNews.sort((a, b) => new Date(b.date) - new Date(a.date));

    return allNews.slice(0, 20); // РўРѕРї 20 РЅРѕРІРѕСЃС‚РµР№
}

// Р¤СѓРЅРєС†РёСЏ РїРѕР»СѓС‡РµРЅРёСЏ LOL РЅРѕРІРѕСЃС‚РµР№
async function fetchLoLNews() {
    const allNews = [];
    for (const feed of LOL_RSS_FEEDS) {
        try {
            const data = await rssParser.parseURL(feed.url);
            const items = data.items.slice(0, 10).map(item => {
                // РР·РІР»РµРєР°РµРј РєР°СЂС‚РёРЅРєСѓ РёР· РЅРѕРІРѕСЃС‚Рё
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
                // Fallback: РїРѕРїСЂРѕР±СѓРµРј РІСЃС‚СЂРѕРµРЅРЅС‹Рµ РєР°СЂС‚РёРЅРєРё РёР· content:encoded
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
            console.log('вљ пёЏ LOL RSS РѕС€РёР±РєР°:', feed.name, err.message);
        }
    }

    // Р¤РёР»СЊС‚СЂСѓРµРј С‚РѕР»СЊРєРѕ LOL-РєРѕРЅС‚РµРЅС‚
    const lolNews = allNews.filter(item => isLoLContent(item.title, item.content));
    console.log(`рџЋ® LOL РЅРѕРІРѕСЃС‚РµР№ РїРѕСЃР»Рµ С„РёР»СЊС‚СЂР°С†РёРё: ${lolNews.length} РёР· ${allNews.length}`);

    // РЎРѕСЂС‚РёСЂСѓРµРј РїРѕ РґР°С‚Рµ (РЅРѕРІС‹Рµ СЃРІРµСЂС…Сѓ)
    lolNews.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Р‘РµСЂС‘Рј С‚РѕРї 10 Рё РїРµСЂРµРІРѕРґРёРј РЅР° СЂСѓСЃСЃРєРёР№
    const topNews = lolNews.slice(0, 10);
    for (const item of topNews) {
        item.title = await translateToRussian(item.title);
        item.content = await translateToRussian(item.content);
    }

    return topNews;
}

// Р¤СѓРЅРєС†РёСЏ РїСѓР±Р»РёРєР°С†РёРё РЅРѕРІРѕСЃС‚Рё РІ РєР°РЅР°Р»
async function postNewsToChannel(client) {
    try {
        // РС‰РµРј РєР°РЅР°Р» РґР»СЏ РѕР±С‰РёС… РёРіСЂРѕРІС‹С… РЅРѕРІРѕСЃС‚РµР№ (РЅРµ LOL)
        for (const [, guild] of client.guilds.cache) {
            const newsChannel = guild.channels.cache.find(ch => 
                (ch.name.includes('igrovye') || ch.name.includes('igrovye-novosti') || ch.name.includes('РёРіСЂРѕРІС‹Рµ-РЅРѕРІРѕСЃС‚Рё')) && 
                !ch.name.includes('lol')
            );
            if (!newsChannel) {
                console.log('вљ пёЏ РљР°РЅР°Р» РЅРѕРІРѕСЃС‚РµР№ РЅРµ РЅР°Р№РґРµРЅ РЅР° СЃРµСЂРІРµСЂРµ:', guild.name);
                continue;
            }

            console.log(`рџ“° РџСЂРѕРІРµСЂСЏСЋ РЅРѕРІРѕСЃС‚Рё РґР»СЏ ${guild.name}...`);
            const news = await fetchGameNews();
            console.log(`рџ“° РџРѕР»СѓС‡РµРЅРѕ ${news.length} РЅРѕРІРѕСЃС‚РµР№`);

            if (news.length === 0) {
                console.log('вљ пёЏ РќРµС‚ РЅРѕРІРѕСЃС‚РµР№ РґР»СЏ РїСѓР±Р»РёРєР°С†РёРё');
                continue;
            }

            let posted = 0;
            for (const item of news) {
                // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ РїСѓР±Р»РёРєРѕРІР°Р»Рё Р»Рё СѓР¶Рµ СЌС‚Сѓ РЅРѕРІРѕСЃС‚СЊ
                const newsId = `${item.source}-${item.title}`;
                if (publishedNews.has(newsId)) continue;

                // РџРµСЂРµРІРѕРґРёРј Р·Р°РіРѕР»РѕРІРѕРє Рё РѕРїРёСЃР°РЅРёРµ РЅР° СЂСѓСЃСЃРєРёР№
                const translatedTitle = await translateToRussian(item.title);
                const translatedContent = await translateToRussian(item.content);

                // РџСѓР±Р»РёРєСѓРµРј РЅРѕРІРѕСЃС‚СЊ
                const embed = new EmbedBuilder()
                    .setColor(getColorBySource(item.source))
                    .setTitle(`${item.emoji} ${translatedTitle}`)
                    .setDescription(translatedContent.substring(0, 500) + (translatedContent.length > 500 ? '...' : ''))
                    .addFields(
                        { name: 'рџ“° РСЃС‚РѕС‡РЅРёРє', value: item.source, inline: true },
                        { name: 'рџ•ђ Р”Р°С‚Р°', value: formatDate(item.date), inline: true }
                    )
                    .setURL(item.link)
                    .setTimestamp();

                // Р”РѕР±Р°РІР»СЏРµРј РєР°СЂС‚РёРЅРєСѓ РµСЃР»Рё РµСЃС‚СЊ
                if (item.image) {
                    try {
                        embed.setImage(item.image);
                    } catch (err) {
                        // РљР°СЂС‚РёРЅРєР° РјРѕР¶РµС‚ Р±С‹С‚СЊ РЅРµРґРѕСЃС‚СѓРїРЅР° - РїСЂРѕСЃС‚Рѕ РїСЂРѕРїСѓСЃРєР°РµРј
                    }
                }

                await newsChannel.send({ embeds: [embed] }).catch(err => {
                    console.error('вќЊ РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё:', err.message);
                });

                // Р”РѕР±Р°РІР»СЏРµРј РІ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹Рµ
                publishedNews.add(newsId);
                posted++;

                // Р—Р°РґРµСЂР¶РєР° РјРµР¶РґСѓ СЃРѕРѕР±С‰РµРЅРёСЏРјРё (С‡С‚РѕР±С‹ РЅРµ СЃРїР°РјРёС‚СЊ)
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            console.log(`вњ… РћРїСѓР±Р»РёРєРѕРІР°РЅРѕ ${posted} РЅРѕРІС‹С… РЅРѕРІРѕСЃС‚РµР№`);
        }
    } catch (err) {
        console.error('вќЊ РћС€РёР±РєР° РїСѓР±Р»РёРєР°С†РёРё РЅРѕРІРѕСЃС‚РµР№:', err);
    }
}

// Р¦РІРµС‚Р° РїРѕ РёСЃС‚РѕС‡РЅРёРєР°Рј
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

// Р¤РѕСЂРјР°С‚РёСЂРѕРІР°РЅРёРµ РґР°С‚С‹
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
        return 'РќРµРґР°РІРЅРѕ';
    }
}

// РџРµСЂРµРІРѕРґ С‚РµРєСЃС‚Р° РЅР° СЂСѓСЃСЃРєРёР№ (С‡РµСЂРµР· Р±РµСЃРїР»Р°С‚РЅС‹Р№ API)
async function translateToRussian(text) {
    if (!text || text.length < 10) return text;

    try {
        // РСЃРїРѕР»СЊР·СѓРµРј MyMemory API (Р±РµСЃРїР»Р°С‚РЅС‹Р№, Р±РµР· РєР»СЋС‡Р°)
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
        console.error('вљ пёЏ РћС€РёР±РєР° РїРµСЂРµРІРѕРґР°:', err.message);
    }

    // Fallback: РІРѕР·РІСЂР°С‰Р°РµРј РѕСЂРёРіРёРЅР°Р»СЊРЅС‹Р№ С‚РµРєСЃС‚
    return text;
}

// ==================== РљРћРњРђРќР”Р« ====================

const commands = new Map();

// --- РњРћР”Р•Р РђР¦РРЇ ---

commands.set('kick', {
    name: 'kick',
    description: 'Р’С‹РіРЅР°С‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°',
    usage: '!kick @user [РїСЂРёС‡РёРЅР°]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РєРёРє!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('вќЊ РЈРєР°Р¶Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: !kick @user [РїСЂРёС‡РёРЅР°]');

        const reason = args.slice(1).join(' ') || 'РќРµ СѓРєР°Р·Р°РЅР°';

        try {
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('рџ‘ў РЈС‡Р°СЃС‚РЅРёРє РІС‹РіРЅР°РЅ')
                .addFields(
                    { name: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ', value: `${member.user.tag}`, inline: true },
                    { name: 'РњРѕРґРµСЂР°С‚РѕСЂ', value: `${message.author.tag}`, inline: true },
                    { name: 'РџСЂРёС‡РёРЅР°', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ РєРёРєРЅСѓС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°!');
        }
    }
});

commands.set('ban', {
    name: 'ban',
    description: 'Р—Р°Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°',
    usage: '!ban @user [РїСЂРёС‡РёРЅР°]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° Р±Р°РЅ!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('вќЊ РЈРєР°Р¶Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: !ban @user [РїСЂРёС‡РёРЅР°]');

        const reason = args.slice(1).join(' ') || 'РќРµ СѓРєР°Р·Р°РЅР°';

        try {
            await member.ban({ reason });
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('рџ”Ё РЈС‡Р°СЃС‚РЅРёРє Р·Р°Р±Р°РЅРµРЅ')
                .addFields(
                    { name: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ', value: `${member.user.tag}`, inline: true },
                    { name: 'РњРѕРґРµСЂР°С‚РѕСЂ', value: `${message.author.tag}`, inline: true },
                    { name: 'РџСЂРёС‡РёРЅР°', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°!');
        }
    }
});

commands.set('unban', {
    name: 'unban',
    description: 'Р Р°Р·Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°',
    usage: '!unban userID',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° СЂР°Р·Р±Р°РЅ!');
        }

        const userId = args[0];
        if (!userId) return message.reply('вќЊ РЈРєР°Р¶Рё ID РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: !unban 123456789');

        try {
            await message.guild.members.unban(userId);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('вњ… РЈС‡Р°СЃС‚РЅРёРє СЂР°Р·Р±Р°РЅРµРЅ')
                .setDescription(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ ID ${userId} СЂР°Р·Р±Р°РЅРµРЅ`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°!');
        }
    }
});

commands.set('mute', {
    name: 'mute',
    description: 'Р—Р°РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°',
    usage: '!mute @user [РјРёРЅСѓС‚С‹] [РїСЂРёС‡РёРЅР°]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РјСѓС‚!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('вќЊ РЈРєР°Р¶Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: !mute @user [РјРёРЅСѓС‚С‹] [РїСЂРёС‡РёРЅР°]');

        const minutes = parseInt(args[1]) || 10;
        const reason = args.slice(2).join(' ') || 'РќРµ СѓРєР°Р·Р°РЅР°';

        try {
            await member.timeout(minutes * 60 * 1000, reason);
            const embed = new EmbedBuilder()
                .setColor(0xffa500)
                .setTitle('рџ”‡ РЈС‡Р°СЃС‚РЅРёРє Р·Р°РјСѓС‡РµРЅ')
                .addFields(
                    { name: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ', value: `${member.user.tag}`, inline: true },
                    { name: 'Р’СЂРµРјСЏ', value: `${minutes} РјРёРЅ.`, inline: true },
                    { name: 'РњРѕРґРµСЂР°С‚РѕСЂ', value: `${message.author.tag}`, inline: true },
                    { name: 'РџСЂРёС‡РёРЅР°', value: reason }
                )
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°!');
        }
    }
});

commands.set('unmute', {
    name: 'unmute',
    description: 'Р Р°Р·РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°',
    usage: '!unmute @user',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° unmute!');
        }

        const member = message.mentions.members.first();
        if (!member) return message.reply('вќЊ РЈРєР°Р¶Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: !unmute @user');

        try {
            await member.timeout(null);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('рџ”Љ РЈС‡Р°СЃС‚РЅРёРє СЂР°Р·РјСѓС‡РµРЅ')
                .setDescription(`${member.user.tag} РјРѕР¶РµС‚ СЃРЅРѕРІР° РїРёСЃР°С‚СЊ`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°!');
        }
    }
});

commands.set('clear', {
    name: 'clear',
    description: 'РћС‡РёСЃС‚РёС‚СЊ СЃРѕРѕР±С‰РµРЅРёСЏ',
    usage: '!clear [РєРѕР»РёС‡РµСЃС‚РІРѕ]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return message.reply('вќЊ РЈ С‚РµР±СЏ РЅРµС‚ РїСЂР°РІ РЅР° РѕС‡РёСЃС‚РєСѓ!');
        }

        const amount = parseInt(args[0]) || 10;
        if (amount < 1 || amount > 100) return message.reply('вќЊ РЈРєР°Р¶Рё С‡РёСЃР»Рѕ РѕС‚ 1 РґРѕ 100!');

        try {
            await message.channel.bulkDelete(amount + 1);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('рџ—‘пёЏ РЎРѕРѕР±С‰РµРЅРёСЏ СѓРґР°Р»РµРЅС‹')
                .setDescription(`РЈРґР°Р»РµРЅРѕ ${amount} СЃРѕРѕР±С‰РµРЅРёР№`)
                .setTimestamp();
            const msg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => msg.delete(), 3000);
        } catch (err) {
            message.reply('вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ СЃРѕРѕР±С‰РµРЅРёСЏ!');
        }
    }
});

// --- РњРРќР-РР“Р Р« ---

commands.set('random', {
    name: 'random',
    description: 'РЈРіР°РґР°Р№ С‡РёСЃР»Рѕ РѕС‚ 1 РґРѕ 100',
    usage: '!random [С‡РёСЃР»Рѕ]',
    execute(message, args) {
        const guess = parseInt(args[0]);
        const answer = Math.floor(Math.random() * 100) + 1;

        if (!guess) return message.reply('вќЊ РќР°РїРёС€Рё С‡РёСЃР»Рѕ: !random 50');

        if (guess === answer) {
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('рџЋ‰ РўС‹ СѓРіР°РґР°Р»!')
                .setDescription(`Р§РёСЃР»Рѕ Р±С‹Р»Рѕ **${answer}**! РўС‹ РјРѕР»РѕРґРµС†!`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } else {
            const hint = guess > answer ? 'рџ“‰ РњРµРЅСЊС€Рµ!' : 'рџ“€ Р‘РѕР»СЊС€Рµ!';
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('вќЊ РќРµ СѓРіР°РґР°Р»!')
                .setDescription(`${hint} РџРѕРїСЂРѕР±СѓР№ РµС‰С‘ СЂР°Р·!`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        }
    }
});

commands.set('rps', {
    name: 'rps',
    description: 'РљР°РјРµРЅСЊ-РЅРѕР¶РЅРёС†С‹-Р±СѓРјР°РіР°',
    usage: '!rps [РєР°РјРµРЅСЊ/РЅРѕР¶РЅРёС†С‹/Р±СѓРјР°РіР°]',
    execute(message, args) {
        const choices = ['РєР°РјРµРЅСЊ', 'РЅРѕР¶РЅРёС†С‹', 'Р±СѓРјР°РіР°'];
        const userChoice = args[0]?.toLowerCase();

        if (!userChoice || !choices.includes(userChoice)) {
            return message.reply('вќЊ РќР°РїРёС€Рё: !rps РєР°РјРµРЅСЊ/РЅРѕР¶РЅРёС†С‹/Р±СѓРјР°РіР°');
        }

        const botChoice = choices[Math.floor(Math.random() * 3)];

        let result;
        if (userChoice === botChoice) {
            result = 'рџ¤ќ РќРёС‡СЊСЏ!';
        } else if (
            (userChoice === 'РєР°РјРµРЅСЊ' && botChoice === 'РЅРѕР¶РЅРёС†С‹') ||
            (userChoice === 'РЅРѕР¶РЅРёС†С‹' && botChoice === 'Р±СѓРјР°РіР°') ||
            (userChoice === 'Р±СѓРјР°РіР°' && botChoice === 'РєР°РјРµРЅСЊ')
        ) {
            result = 'рџЏ† РўС‹ РїРѕР±РµРґРёР»!';
        } else {
            result = 'рџ’Ђ РўС‹ РїСЂРѕРёРіСЂР°Р»!';
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџЋ® РљР°РјРµРЅСЊ-РќРѕР¶РЅРёС†С‹-Р‘СѓРјР°РіР°')
            .addFields(
                { name: 'РўРІРѕР№ РІС‹Р±РѕСЂ', value: userChoice, inline: true },
                { name: 'РњРѕР№ РІС‹Р±РѕСЂ', value: botChoice, inline: true },
                { name: 'Р РµР·СѓР»СЊС‚Р°С‚', value: result }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('roulette', {
    name: 'roulette',
    description: 'Р СѓР»РµС‚РєР°! РЎС‚Р°РІСЊ С‡РёСЃР»Рѕ 1-36 Рё С†РІРµС‚',
    usage: '!roulette [С‡РёСЃР»Рѕ] [РєСЂР°СЃРЅС‹Р№/С‡С‘СЂРЅС‹Р№/Р·РµР»С‘РЅС‹Р№]',
    execute(message, args) {
        const bet = parseInt(args[0]);
        const color = args[1]?.toLowerCase();

        if (!bet || bet < 1 || bet > 36) {
            return message.reply('вќЊ РЎС‚Р°РІСЊ С‡РёСЃР»Рѕ РѕС‚ 1 РґРѕ 36: !roulette 7 РєСЂР°СЃРЅС‹Р№');
        }
        if (!['РєСЂР°СЃРЅС‹Р№', 'С‡С‘СЂРЅС‹Р№', 'Р·РµР»С‘РЅС‹Р№'].includes(color)) {
            return message.reply('вќЊ РЈРєР°Р¶Рё С†РІРµС‚: РєСЂР°СЃРЅС‹Р№/С‡С‘СЂРЅС‹Р№/Р·РµР»С‘РЅС‹Р№');
        }

        const result = Math.floor(Math.random() * 36) + 1;
        let resultColor;
        if (result === 0) resultColor = 'Р·РµР»С‘РЅС‹Р№';
        else if (result % 2 === 0) resultColor = 'С‡С‘СЂРЅС‹Р№';
        else resultColor = 'РєСЂР°СЃРЅС‹Р№';

        const win = bet === result;
        const colorWin = color === resultColor;

        let emoji;
        if (result === 0) emoji = 'рџџў';
        else if (result % 2 === 0) emoji = 'вљ«';
        else emoji = 'рџ”ґ';

        const embed = new EmbedBuilder()
            .setColor(win ? 0x00ff00 : 0xff0000)
            .setTitle('рџЋ° Р СѓР»РµС‚РєР°')
            .addFields(
                { name: 'РўРІРѕСЏ СЃС‚Р°РІРєР°', value: `${bet} ${color}`, inline: true },
                { name: 'Р’С‹РїР°Р»Рѕ', value: `${emoji} ${result} ${resultColor}`, inline: true },
                { name: 'Р РµР·СѓР»СЊС‚Р°С‚', value: win ? 'рџЏ† Р”Р–Р•РљРџРћРў!' : colorWin ? 'вњ… Р¦РІРµС‚ СѓРіР°РґР°Р»!' : 'рџ’Ђ РџСЂРѕРёРіСЂР°Р»!' }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- РџР РР’Р•РўРЎРўР’РР• ---

commands.set('welcome', {
    name: 'welcome',
    description: 'РќР°СЃС‚СЂРѕРёС‚СЊ РїСЂРёРІРµС‚СЃС‚РІРµРЅРЅС‹Р№ РєР°РЅР°Р»',
    usage: '!welcome #channel',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РЅР°СЃС‚СЂРѕРёС‚СЊ РїСЂРёРІРµС‚СЃС‚РІРёРµ!');
        }

        let channel = message.mentions.channels.first();
        if (!channel && args[0]) {
            const channelName = args[0].replace('#', '');
            channel = message.guild.channels.cache.find(ch => ch.name === channelName);
        }
        if (!channel) return message.reply('вќЊ РЈРєР°Р¶Рё РєР°РЅР°Р»: !welcome #РѕР±С‰РµРµ');

        process.env.WELCOME_CHANNEL = channel.name;
            saveConfig();

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('вњ… РљР°РЅР°Р» РїСЂРёРІРµС‚СЃС‚РІРёСЏ РЅР°СЃС‚СЂРѕРµРЅ')
            .setDescription(`РќРѕРІС‹Рµ СѓС‡Р°СЃС‚РЅРёРєРё Р±СѓРґСѓС‚ РїСЂРёРІРµС‚СЃС‚РІРѕРІР°С‚СЊСЃСЏ РІ ${channel}`)
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- РђР’РўРћ-Р РћР›Р¬ ---

commands.set('autorole', {
    name: 'autorole',
    description: 'РќР°СЃС‚СЂРѕРёС‚СЊ Р°РІС‚РѕСЃ СЂРѕР»СЊ',
    usage: '!autorole @role',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РЅР°СЃС‚СЂРѕРёС‚СЊ Р°РІС‚РѕСЃ СЂРѕР»СЊ!');
        }

        const role = message.mentions.roles.first();
        if (!role) return message.reply('вќЊ РЈРєР°Р¶Рё СЂРѕР»СЊ: !autorole @Member');

        process.env.AUTOROLE = role.id;
            saveConfig();

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('вњ… РђРІС‚РѕСЃ СЂРѕР»СЊ РЅР°СЃС‚СЂРѕРµРЅР°')
            .setDescription(`РќРѕРІС‹Рј СѓС‡Р°СЃС‚РЅРёРєР°Рј Р±СѓРґРµС‚ РІС‹РґР°РІР°С‚СЊСЃСЏ СЂРѕР»СЊ ${role}`)
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- РЎР•Р Р’Р•Р  ---

commands.set('setup', {
    name: 'setup',
    description: 'РЎРѕР·РґР°С‚СЊ РєСЂР°СЃРёРІСѓСЋ СЃС‚СЂСѓРєС‚СѓСЂСѓ СЃРµСЂРІРµСЂР°',
    usage: '!setup',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РЅР°СЃС‚СЂРѕРёС‚СЊ СЃРµСЂРІРµСЂ!');
        }

        const guild = message.guild;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('вљ™пёЏ РЎРѕР·РґР°СЋ СЃС‚СЂСѓРєС‚СѓСЂСѓ СЃРµСЂРІРµСЂР°...')
            .setDescription('РџРѕРґРѕР¶РґРё РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            // РЈРґР°Р»СЏРµРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ РєР°РЅР°Р»С‹ (РєСЂРѕРјРµ С‚РµРєСѓС‰РµРіРѕ)
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

            // РЎРѕР·РґР°С‘Рј СЂРѕР»Рё
            const roleAdmin = await guild.roles.create({ name: 'Admin', color: 0xff0000, permissions: [PermissionsBitField.Flags.Administrator] }).catch(() => null);
            const roleMod = await guild.roles.create({ name: 'Moderator', color: 0xffa500 }).catch(() => null);
            const roleMember = await guild.roles.create({ name: 'Member', color: 0x00ff00 }).catch(() => null);
            const roleMuted = await guild.roles.create({ name: 'Muted', color: 0x808080 }).catch(() => null);

            // РЎРѕР·РґР°С‘Рј РєР°С‚РµРіРѕСЂРёРё Рё РєР°РЅР°Р»С‹

            // рџ“Њ РРќР¤РћР РњРђР¦РРЇ
            const catInfo = await guild.channels.create({ name: 'рџ“Њ РРќР¤РћР РњРђР¦РРЇ', type: 4 });
            await guild.channels.create({ name: 'рџ“њ-РїСЂР°РІРёР»Р°', type: 0, parent: catInfo });
            await guild.channels.create({ name: 'рџ“ў-РѕР±СЉСЏРІР»РµРЅРёСЏ', type: 0, parent: catInfo });
            await guild.channels.create({ name: 'рџЋ«-С‚РёРєРµС‚С‹', type: 0, parent: catInfo });

            // рџ’¬ РўР•РљРЎРўРћР’Р«Р• РљРђРќРђР›Р«
            const catText = await guild.channels.create({ name: 'рџ’¬ РўР•РљРЎРўРћР’Р«Р• РљРђРќРђР›Р«', type: 4 });
            await guild.channels.create({ name: 'рџ‘‹-РѕР±С‰РµРЅРёРµ', type: 0, parent: catText });
            await guild.channels.create({ name: 'рџЋ®-РёРіСЂС‹', type: 0, parent: catText });
            await guild.channels.create({ name: 'рџЋµ-РјСѓР·С‹РєР°', type: 0, parent: catText });
            await guild.channels.create({ name: 'рџ–ј-РјРµРјС‹', type: 0, parent: catText });
            await guild.channels.create({ name: 'рџ¤–-Р±РѕС‚-РєРѕРјР°РЅРґС‹', type: 0, parent: catText });

            // рџ”Љ Р“РћР›РћРЎРћР’Р«Р• РљРђРќРђР›Р«
            const catVoice = await guild.channels.create({ name: 'рџ”Љ Р“РћР›РћРЎРћР’Р«Р• РљРђРќРђР›Р«', type: 4 });
            await guild.channels.create({ name: 'рџ”Љ Р›РѕР±Р±Рё', type: 2, parent: catVoice });
            await guild.channels.create({ name: 'рџЋ® РРіСЂС‹', type: 2, parent: catVoice });
            await guild.channels.create({ name: 'рџЋµ РњСѓР·С‹РєР°', type: 2, parent: catVoice });
            await guild.channels.create({ name: 'рџ’¬ Р Р°Р·РіРѕРІРѕСЂС‹', type: 2, parent: catVoice });

            // рџ›Ў РњРћР”Р•Р РђР¦РРЇ
            const catMod = await guild.channels.create({ name: 'рџ›Ў РњРћР”Р•Р РђР¦РРЇ', type: 4 });
            await guild.channels.create({ name: 'рџ“‹-Р»РѕРіРё', type: 0, parent: catMod });
            await guild.channels.create({ name: 'вљЎ-РјРѕРґРµСЂР°С†РёСЏ-С‡Р°С‚', type: 0, parent: catMod });

            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('вњ… РЎРµСЂРІРµСЂ РіРѕС‚РѕРІ!')
                .setDescription('РЎРѕР·РґР°РЅР° РєСЂР°СЃРёРІР°СЏ СЃС‚СЂСѓРєС‚СѓСЂР°:')
                .addFields(
                    { name: 'рџ“Њ РРЅС„РѕСЂРјР°С†РёСЏ', value: 'РџСЂР°РІРёР»Р°, РћР±СЉСЏРІР»РµРЅРёСЏ, РўРёРєРµС‚С‹', inline: true },
                    { name: 'рџ’¬ РўРµРєСЃС‚РѕРІС‹Рµ', value: 'РћР±С‰РµРЅРёРµ, РРіСЂС‹, РњСѓР·С‹РєР°, РњРµРјС‹, Р‘РѕС‚', inline: true },
                    { name: 'рџ”Љ Р“РѕР»РѕСЃРѕРІС‹Рµ', value: 'Р›РѕР±Р±Рё, РРіСЂС‹, РњСѓР·С‹РєР°, Р Р°Р·РіРѕРІРѕСЂС‹', inline: true },
                    { name: 'рџ›Ў РњРѕРґРµСЂР°С†РёСЏ', value: 'Р›РѕРіРё, РњРѕРґРµСЂР°С†РёСЏ С‡Р°С‚', inline: true },
                    { name: 'рџЋ­ Р РѕР»Рё', value: 'Admin, Moderator, Member, Muted', inline: true }
                )
                .setTimestamp();
            msg.edit({ embeds: [successEmbed] });
        } catch (err) {
            console.error('вќЊ РћС€РёР±РєР° setup:', err);
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('вќЊ РћС€РёР±РєР°').setDescription(err.message)] });
        }
    }
});

// --- РР“Р РћР’Р«Р• РќРћР’РћРЎРўР ---

commands.set('gamenews', {
    name: 'gamenews',
    description: 'РЎРѕР·РґР°С‚СЊ РєР°С‚РµРіРѕСЂРёСЋ "рџЋ® РР“Р РћР’Р«Р• РќРћР’РћРЎРўР"',
    usage: '!gamenews',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ!');
        }

        const guild = message.guild;
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('рџЋ® РЎРѕР·РґР°СЋ РєР°РЅР°Р»С‹...').setTimestamp()] });

        try {
            const category = await guild.channels.create({ name: 'рџЋ® РР“Р РћР’Р«Р• РќРћР’РћРЎРўР', type: 4 });
            await new Promise(r => setTimeout(r, 1000));

            const ch1 = await guild.channels.create({ name: 'рџ“°-РёРіСЂРѕРІС‹Рµ-РЅРѕРІРѕСЃС‚Рё', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch2 = await guild.channels.create({ name: 'рџЋ®-lol-РЅРѕРІРѕСЃС‚Рё', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch3 = await guild.channels.create({ name: 'вљ”пёЏ-lol-РіР°Р№РґС‹', type: 0, parent: category });
            await new Promise(r => setTimeout(r, 500));
            const ch4 = await guild.channels.create({ name: 'рџ’¬-lol-РєРѕРјР°РЅРґС‹', type: 0, parent: category });

            const everyone = guild.roles.everyone;
            const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
            const adminRole = guild.roles.cache.find(r => r.name === 'Admin');
            const modRole = guild.roles.cache.find(r => r.name === 'Moderator');

            // РљР°РЅР°Р»С‹ Р°РІС‚РѕРїРѕСЃС‚РёРЅРіР° - РЅРёРєС‚Рѕ РЅРµ РїРёС€РµС‚ РєСЂРѕРјРµ.owner Рё Admin
            for (const ch of [ch1, ch2, ch3]) {
                await ch.permissionOverwrites.edit(everyone, { SendMessages: false });
                if (owner) await ch.permissionOverwrites.edit(owner, { SendMessages: true });
                if (adminRole) await ch.permissionOverwrites.edit(adminRole, { SendMessages: true });
            }

            // РљР°РЅР°Р» РєРѕРјР°РЅРґ - РїРёС€РµС‚ С‚РѕР»СЊРєРѕ.owner, Admin, Moderator
            await ch4.permissionOverwrites.edit(everyone, { SendMessages: false });
            if (owner) await ch4.permissionOverwrites.edit(owner, { SendMessages: true });
            if (adminRole) await ch4.permissionOverwrites.edit(adminRole, { SendMessages: true });
            if (modRole) await ch4.permissionOverwrites.edit(modRole, { SendMessages: true });

            await new Promise(r => setTimeout(r, 2000));

            // РџСЂРёРІРµС‚СЃС‚РІРёСЏ
            await ch1.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('рџ“° РР“Р РћР’Р«Р• РќРћР’РћРЎРўР').setDescription('РџРѕСЃР»РµРґРЅРёРµ РЅРѕРІРѕСЃС‚Рё РёР· РјРёСЂР° РёРіСЂ!\n\nGTA, Cyberpunk, Call of Duty Рё РґСЂСѓРіРёРµ.\nРџРµСЂРµРІРѕРґ РЅР° СЂСѓСЃСЃРєРёР№ СЏР·С‹Рє.\nРђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ РєР°Р¶РґС‹Рµ 4 С‡Р°СЃР°.').setTimestamp()] });
            await ch2.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('рџЋ® LOL РќРћР’РћРЎРўР').setDescription('РџРѕСЃР»РµРґРЅРёРµ РЅРѕРІРѕСЃС‚Рё League of Legends!\n\nРџР°С‚С‡-РЅРѕСѓС‚С‹, РЅРѕРІС‹Рµ С‡РµРјРїРёРѕРЅС‹, СЃРєРёРЅС‹.\nРўСѓСЂРЅРёСЂРЅС‹Рµ РЅРѕРІРѕСЃС‚Рё.\nРђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ.').setTimestamp()] });
            await ch3.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('вљ”пёЏ LOL Р“РђР™Р”Р« Р РЎРўРђРўРРЎРўРРљРђ').setDescription('Tier List, СЃР±РѕСЂРєРё, СЂРµР№С‚РёРЅРіРё!\n\nР”Р°РЅРЅС‹Рµ: OP.GG | РџР°С‚С‡ 16.13\nРђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ РєР°Р¶РґС‹Рµ 6-12 С‡Р°СЃРѕРІ.').setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png').setTimestamp()] });
            await ch3.send({ embeds: [createTierListEmbed()] });
            await ch4.send({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('рџ’¬ LOL РљРћРњРђРќР”Р«').setDescription('РџРёС€РёС‚Рµ РєРѕРјР°РЅРґС‹ Р·РґРµСЃСЊ! Р‘РѕС‚ РѕС‚РІРµС‚РёС‚.\n\n**Р”РѕСЃС‚СѓРїРЅС‹Рµ РєРѕРјР°РЅРґС‹:**\n`!tierlist` вЂ” Tier List\n`!top mid` вЂ” РўРѕРї С‡РµРјРїРёРѕРЅРѕРІ\n`!builds mid` вЂ” РЎР±РѕСЂРєРё\n`!rating` вЂ” Р РµР№С‚РёРЅРі\n`!counter Ahri` вЂ” РЎС‚Р°С‚РёСЃС‚РёРєР°\n`!lolnews` вЂ” РќРѕРІРѕСЃС‚Рё\n`!lolhelp` вЂ” РџРѕРґСЂРѕР±РЅР°СЏ РїРѕРјРѕС‰СЊ').setTimestamp()] });

            await msg.edit({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('вњ… РљР°РЅР°Р»С‹ СЃРѕР·РґР°РЅС‹!').setDescription('рџ“°-РёРіСЂРѕРІС‹Рµ-РЅРѕРІРѕСЃС‚Рё\nрџЋ®-lol-РЅРѕРІРѕСЃС‚Рё\nвљ”пёЏ-lol-РіР°Р№РґС‹\nрџ’¬-lol-РєРѕРјР°РЅРґС‹').setTimestamp()] });

        } catch (err) {
            console.error('вќЊ РћС€РёР±РєР° gamenews:', err);
            await msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('вќЊ РћС€РёР±РєР°').setDescription(err.message)] });
        }
    }
});

// --- РћРўРџР РђР’РРўР¬ Р’ TELEGRAM ---

commands.set('tg', {
    name: 'tg',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РІ Telegram',
    usage: '!tg [СЃРѕРѕР±С‰РµРЅРёРµ]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ!');
        }

        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            return message.reply('вќЊ Telegram РЅРµ РЅР°СЃС‚СЂРѕРµРЅ! Р”РѕР±Р°РІСЊ TELEGRAM_BOT_TOKEN Рё TELEGRAM_CHAT_ID РІ .env');
        }

        const text = args.join(' ');
        if (!text) return message.reply('вќЊ РќР°РїРёС€Рё СЃРѕРѕР±С‰РµРЅРёРµ: !tg РџСЂРёРІРµС‚ РёР· Discord!');

        await sendToTelegram(text);
        message.reply('вњ… РћС‚РїСЂР°РІР»РµРЅРѕ РІ Telegram!');
    }
});

// --- РћРўРџР РђР’РРўР¬ РџР РР’Р•РўРЎРўР’РРЇ ---

commands.set('postwelcome', {
    name: 'postwelcome',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ РїСЂРёРІРµС‚СЃС‚РІРµРЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ',
    usage: '!postwelcome',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ!');
        }

        const guild = message.guild;
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('рџ“ў РћС‚РїСЂР°РІР»СЏСЋ...').setTimestamp()] });

        // РџРѕР»СѓС‡Р°РµРј Р’РЎР• С‚РµРєСЃС‚РѕРІС‹Рµ РєР°РЅР°Р»С‹
        const channels = guild.channels.cache.filter(ch => ch.type === 0);
        
        let sent = 0;

        for (const [, channel] of channels) {
            try {
                // РџСЂРѕРІРµСЂСЏРµРј РЅР°Р·РІР°РЅРёРµ РєР°РЅР°Р»Р°
                const name = channel.name;
                
                if (name.includes('РёРіСЂРѕРІС‹Рµ') && name.includes('РЅРѕРІРѕСЃС‚Рё')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('рџ“° РР“Р РћР’Р«Р• РќРћР’РћРЎРўР').setDescription('GTA, Cyberpunk, Call of Duty Рё РґСЂСѓРіРёРµ РёРіСЂС‹!\nРђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ РєР°Р¶РґС‹Рµ 4 С‡Р°СЃР°.').setTimestamp()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('РЅРѕРІРѕСЃС‚Рё')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('рџЋ® LOL РќРћР’РћРЎРўР').setDescription('РџР°С‚С‡-РЅРѕСѓС‚С‹, СЃРєРёРЅС‹, С‚СѓСЂРЅРёСЂС‹!\nРђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ.').setTimestamp()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('РіР°Р№РґС‹')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle('вљ”пёЏ LOL Р“РђР™Р”Р«').setDescription('Tier List, СЃР±РѕСЂРєРё, СЂРµР№С‚РёРЅРіРё!\nРџРёС€РёС‚Рµ РєРѕРјР°РЅРґС‹ РІ рџ’¬-lol-РєРѕРјР°РЅРґС‹').setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png').setTimestamp()] });
                    await channel.send({ embeds: [createTierListEmbed()] });
                    sent++;
                }
                
                if (name.includes('lol') && name.includes('РєРѕРјР°РЅРґС‹')) {
                    await channel.send({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle('рџ’¬ LOL РљРћРњРђРќР”Р«').setDescription('РџРёС€РёС‚Рµ РєРѕРјР°РЅРґС‹ Р·РґРµСЃСЊ!\n\n!tierlist - Tier List\n!top mid - РўРѕРї С‡РµРјРїРёРѕРЅРѕРІ\n!builds mid - РЎР±РѕСЂРєРё\n!rating - Р РµР№С‚РёРЅРі\n!counter Ahri - РЎС‚Р°С‚РёСЃС‚РёРєР°\n!lolnews - РќРѕРІРѕСЃС‚Рё').setTimestamp()] });
                    sent++;
                }
            } catch (err) {
                console.log('вќЊ РћС€РёР±РєР° РІ РєР°РЅР°Р»Рµ', channel.name, err.message);
            }
        }

        await msg.edit({ embeds: [new EmbedBuilder().setColor(0x00ff00).setTitle(`вњ… Р“РѕС‚РѕРІРѕ! РћС‚РїСЂР°РІР»РµРЅРѕ РІ ${sent} РєР°РЅР°Р»РѕРІ`).setTimestamp()] });
    }
});

// --- РћР‘РќРћР’РРўР¬ РќРћР’РћРЎРўР ---

commands.set('news', {
    name: 'news',
    description: 'РћР±РЅРѕРІРёС‚СЊ РёРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё РІСЂСѓС‡РЅСѓСЋ',
    usage: '!news',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РѕР±РЅРѕРІР»СЏС‚СЊ РЅРѕРІРѕСЃС‚Рё!');
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџЋ® РћР±РЅРѕРІР»СЏСЋ РёРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё...')
            .setDescription('РџРѕРґРѕР¶РґРё РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            await postNewsToChannel(message.client);

            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('вњ… РќРѕРІРѕСЃС‚Рё РѕР±РЅРѕРІР»РµРЅС‹!')
                .setDescription('РќРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё РѕРїСѓР±Р»РёРєРѕРІР°РЅС‹ РІ РєР°РЅР°Р»Рµ **рџЋ®-РЅРѕРІРѕСЃС‚Рё**')
                .setTimestamp();
            msg.edit({ embeds: [successEmbed] });
        } catch (err) {
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('вќЊ РћС€РёР±РєР°').setDescription(err.message)] });
        }
    }
});

// --- LOL РљРћРњРђРќР”Р« ---

commands.set('tierlist', {
    name: 'tierlist',
    description: 'Tier List С‡РµРјРїРёРѕРЅРѕРІ РїРѕ С‚РёСЂР°Рј',
    usage: '!tierlist',
    async execute(message) {
        const embed = createTierListEmbed();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('top', {
    name: 'top',
    description: 'РўРѕРї С‡РµРјРїРёРѕРЅРѕРІ РїРѕ Р»РёРЅРёРё',
    usage: '!top [mid/adc/support/jungle/top]',
    async execute(message, args) {
        const position = args[0]?.toLowerCase();
        if (!position || !['mid', 'adc', 'support', 'jungle', 'top'].includes(position)) {
            return message.reply('вќЊ РЈРєР°Р¶Рё Р»РёРЅРёСЋ: `!top mid` `!top adc` `!top support` `!top jungle` `!top top`');
        }

        const embeds = createTopChampionsEmbed(position);
        if (embeds && embeds.length > 0) {
            // Discord РїРѕР·РІРѕР»СЏРµС‚ РѕС‚РїСЂР°РІРёС‚СЊ РґРѕ 10 embed Р·Р° СЂР°Р·
            for (let i = 0; i < embeds.length; i += 10) {
                await message.channel.send({ embeds: embeds.slice(i, i + 10) });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }
});

commands.set('builds', {
    name: 'builds',
    description: 'РўРѕРї СЃР±РѕСЂРєРё РїРѕ РїРѕР·РёС†РёРё',
    usage: '!builds [mid/adc/support/jungle/top]',
    async execute(message, args) {
        const position = args[0]?.toLowerCase();
        if (!position || !['mid', 'adc', 'support', 'jungle', 'top'].includes(position)) {
            return message.reply('вќЊ РЈРєР°Р¶Рё РїРѕР·РёС†РёСЋ: `!builds mid` `!builds adc` `!builds support` `!builds jungle` `!builds top`');
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
    description: 'Р РµР№С‚РёРЅРі С‡РµРјРїРёРѕРЅРѕРІ РїРѕ РїРѕР·РёС†РёСЏРј',
    usage: '!rating',
    async execute(message) {
        const embed = createRatingEmbed();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('counter', {
    name: 'counter',
    description: 'РџРѕРєР°Р·Р°С‚СЊ РєРѕРЅС‚СЂС‹ С‡РµРјРїРёРѕРЅР°',
    usage: '!counter [РёРјСЏ С‡РµРјРїРёРѕРЅР°]',
    async execute(message, args) {
        const champ = args[0];
        if (!champ) return message.reply('вќЊ РЈРєР°Р¶Рё С‡РµРјРїРёРѕРЅР°: `!counter Ahri`');

        // РС‰РµРј С‡РµРјРїРёРѕРЅР° РІРѕ РІСЃРµС… РїРѕР·РёС†РёСЏС…
        let foundChamp = null;
        for (const champions of Object.values(LOL_CHAMPIONS)) {
            foundChamp = champions.find(c => c.name.toLowerCase() === champ.toLowerCase());
            if (foundChamp) break;
        }

        if (!foundChamp) return message.reply('вќЊ Р§РµРјРїРёРѕРЅ РЅРµ РЅР°Р№РґРµРЅ! РџРѕРїСЂРѕР±СѓР№: Ahri, Jinx, Thresh, Garen, Nasus');

        const embed = new EmbedBuilder()
            .setColor(getTierColor(foundChamp.tier))
            .setTitle(`${getTierEmoji(foundChamp.tier)} ${foundChamp.name}`)
            .setDescription(`**РЎС‚Р°С‚РёСЃС‚РёРєР° С‡РµРјРїРёРѕРЅР°** (Emerald+)`)
            .addFields(
                { name: 'рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°', value: `**WR:** ${foundChamp.winRate} | **PR:** ${foundChamp.pickRate} | **BR:** ${foundChamp.banRate}`, inline: false },
                { name: 'рџ”® Р СѓРЅР°', value: foundChamp.rune, inline: true },
                { name: 'рџ›Ў РЎР±РѕСЂРєР°', value: foundChamp.items.join(' в†’ '), inline: true }
            )
            .setThumbnail(getChampionImage(foundChamp.name))
            .setFooter({ text: 'Р”Р°РЅРЅС‹Рµ: OP.GG | Emerald+' })
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

commands.set('lolnews', {
    name: 'lolnews',
    description: 'РќРѕРІРѕСЃС‚Рё League of Legends',
    usage: '!lolnews',
    async execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџ“° Р—Р°РіСЂСѓР¶Р°СЋ РЅРѕРІРѕСЃС‚Рё LOL...')
            .setTimestamp();
        const msg = await message.channel.send({ embeds: [embed] });

        try {
            const news = await fetchLoLNews();

            if (news.length === 0) {
                return msg.edit({ embeds: [new EmbedBuilder().setColor(0xffa500).setTitle('вљ пёЏ РќРµС‚ РЅРѕРІРѕСЃС‚РµР№').setDescription('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РЅРѕРІРѕСЃС‚Рё LOL')] });
            }

            const embeds = news.map(item => {
                // item.title уже переведён в fetchLoLNews()
                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle(`${item.emoji} ${item.title}`)
                    .setDescription(item.content.substring(0, 300) + '...')
                    .addFields(
                        { name: 'рџ“° РСЃС‚РѕС‡РЅРёРє', value: item.source, inline: true }
                    )
                    .setURL(item.link)
                    .setTimestamp();

                if (item.image) {
                    try { embed.setImage(item.image); } catch (e) {}
                }

                return embed;
            });

            // Отправляем все embed пакетом по 10 (1 уведомление)
            const allEmbeds = embeds.slice(0, 10);
            await msg.edit({ embeds: allEmbeds });
        } catch (err) {
            msg.edit({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('вќЊ РћС€РёР±РєР°').setDescription(err.message)] });
        }
    }
});

// --- РџРћРњРћР©Р¬ РџРћ LOL ---

commands.set('lolhelp', {
    name: 'lolhelp',
    description: 'РџРѕРґСЂРѕР±РЅР°СЏ РїРѕРјРѕС‰СЊ РїРѕ LOL РєРѕРјР°РЅРґР°Рј',
    usage: '!lolhelp',
    async execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('вљ”пёЏ РџРћРњРћР©Р¬ РџРћ LEAGUE OF LEGENDS')
            .setDescription('Р’СЃРµ РєРѕРјР°РЅРґС‹ РґР»СЏ LOL СЃ РїСЂРёРјРµСЂР°РјРё:')
            .addFields(
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ“Љ TIER LIST**', inline: false },
                { name: '`!tierlist`', value: 'РџРѕРєР°Р·Р°С‚СЊ С‚РµРєСѓС‰РёР№ Tier List С‡РµРјРїРёРѕРЅРѕРІ\nРџСЂРёРјРµСЂ: `!tierlist`', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ›Ў РЎР‘РћР РљР**', inline: false },
                { name: '`!builds [РїРѕР·РёС†РёСЏ]`', value: 'РўРѕРї СЃР±РѕСЂРєРё РїРѕ РїРѕР·РёС†РёРё\nРџРѕР·РёС†РёРё: `mid` `adc` `support` `jungle` `top`\nРџСЂРёРјРµСЂ: `!builds mid`', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџЏ† Р Р•Р™РўРРќР“**', inline: false },
                { name: '`!rating`', value: 'Р РµР№С‚РёРЅРі С‡РµРјРїРёРѕРЅРѕРІ РїРѕ РїРѕР·РёС†РёСЏРј\nРџСЂРёРјРµСЂ: `!rating`', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ›Ў РљРћРќРўР Р«**', inline: false },
                { name: '`!counter [С‡РµРјРїРёРѕРЅ]`', value: 'Р›СѓС‡С€РёРµ РєРѕРЅС‚СЂС‹ РїСЂРѕС‚РёРІ С‡РµРјРїРёРѕРЅР°\nРџСЂРёРјРµСЂ: `!counter Ahri`', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ“° РќРћР’РћРЎРўР**', inline: false },
                { name: '`!lolnews`', value: 'РќРѕРІРѕСЃС‚Рё LOL РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ СЃ РєР°СЂС‚РёРЅРєР°РјРё\nРСЃС‚РѕС‡РЅРёРєРё: Surrender at 20, LoL Esports, LeagueFeed\nРџСЂРёРјРµСЂ: `!lolnews`', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**вЏ° РђР’РўРћ-РћР‘РќРћР’Р›Р•РќРР•**', inline: false },
                { name: 'Tier List', value: 'РљР°Р¶РґС‹Рµ 6 С‡Р°СЃРѕРІ (09:00, 15:00, 21:00)', inline: true },
                { name: 'РЎР±РѕСЂРєРё', value: 'РљР°Р¶РґС‹Рµ 8 С‡Р°СЃРѕРІ (10:00, 18:00)', inline: true },
                { name: 'Р РµР№С‚РёРЅРі', value: 'РљР°Р¶РґС‹Рµ 12 С‡Р°СЃРѕРІ (00:00, 12:00)', inline: true }
            )
            .setThumbnail('https://ddragon.leagueoflegends.com/cdn/16.13.1/img/champion/Ahri.png')
            .setFooter({ text: 'Р”Р°РЅРЅС‹Рµ: OP.GG | Р’СЃРµ РґР°РЅРЅС‹Рµ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ' })
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- Р’Р•Р РР¤РРљРђР¦РРЇ ---

commands.set('verify', {
    name: 'verify',
    description: 'РЎРѕР·РґР°С‚СЊ СЃРёСЃС‚РµРјСѓ РІРµСЂРёС„РёРєР°С†РёРё',
    usage: '!verify #РєР°РЅР°Р»',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РЅР°СЃС‚СЂР°РёРІР°С‚СЊ РІРµСЂРёС„РёРєР°С†РёСЋ!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('вќЊ РЈРєР°Р¶Рё РєР°РЅР°Р»: !verify #.verify');

        let verifiedRole = message.guild.roles.cache.find(r => r.name === 'Verified');
        if (!verifiedRole) {
            verifiedRole = await message.guild.roles.create({
                name: 'Verified',
                color: 0x00ff00,
            }).catch(() => null);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('вњ… Р’РµСЂРёС„РёРєР°С†РёСЏ')
            .setDescription('РќР°Р¶РјРё вњ… С‡С‚РѕР±С‹ РїРѕРґС‚РІРµСЂРґРёС‚СЊ, С‡С‚Рѕ С‚С‹ РЅРµ Р±РѕС‚, Рё РїРѕР»СѓС‡РёС‚СЊ РґРѕСЃС‚СѓРї Рє СЃРµСЂРІРµСЂСѓ!')
            .setFooter({ text: 'Р‘РµР· РІРµСЂРёС„РёРєР°С†РёРё С‚С‹ РЅРµ СЃРјРѕР¶РµС€СЊ РїРёСЃР°С‚СЊ РІ С‡Р°С‚Р°С….' })
            .setTimestamp();

        const msg = await channel.send({ embeds: [embed] });
        await msg.react('вњ…');

        message.reply(`вњ… Р’РµСЂРёС„РёРєР°С†РёСЏ РЅР°СЃС‚СЂРѕРµРЅР° РІ ${channel}`);
    }
});

// --- РџР РђР’РР›Рђ ---

commands.set('rules', {
    name: 'rules',
    description: 'РћРїСѓР±Р»РёРєРѕРІР°С‚СЊ РїСЂР°РІРёР»Р° СЃРµСЂРІРµСЂР°',
    usage: '!rules',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РїСѓР±Р»РёРєРѕРІР°С‚СЊ РїСЂР°РІРёР»Р°!');
        }

        const rulesChannel = message.guild.channels.cache.find(ch => ch.name === 'рџ“њ-РїСЂР°РІРёР»Р°');
        if (!rulesChannel) return message.reply('вќЊ РљР°РЅР°Р» #рџ“њ-РїСЂР°РІРёР»Р° РЅРµ РЅР°Р№РґРµРЅ!');

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџ“њ РџР РђР’РР›Рђ РЎР•Р Р’Р•Р Рђ')
            .setDescription('Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РЅР° **РЎРµСЂРІРµСЂ ZOHAN**! РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РѕР·РЅР°РєРѕРјСЊС‚РµСЃСЊ СЃ РїСЂР°РІРёР»Р°РјРё РїРµСЂРµРґ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРµРј СЃРµСЂРІРµСЂР°.')
            .addFields(
                { name: '1пёЏвѓЈ РЈРІР°Р¶РµРЅРёРµ', value: 'РЈРІР°Р¶Р°Р№С‚Рµ РґСЂСѓРіРёС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ. Р—Р°РїСЂРµС‰РµРЅС‹ РѕСЃРєРѕСЂР±Р»РµРЅРёСЏ, РґРёСЃРєСЂРёРјРёРЅР°С†РёСЏ, СЂР°СЃРёР·Рј Рё Р»СЋР±С‹Рµ С„РѕСЂРјС‹ С…Р°СЂР°СЃСЃРјРµРЅС‚Р°.' },
                { name: '2пёЏвѓЈ РЎРїР°Рј Рё СЂРµРєР»Р°РјР°', value: 'Р—Р°РїСЂРµС‰С‘РЅ СЃРїР°Рј, РјР°СЃСЃРѕРІС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ, СЂРµРєР»Р°РјР° РґСЂСѓРіРёС… СЃРµСЂРІРµСЂРѕРІ, Р±РѕС‚РѕРІ Рё С‚РѕРІР°СЂРѕРІ Р±РµР· СЂР°Р·СЂРµС€РµРЅРёСЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.' },
                { name: '3пёЏвѓЈ РЎСЃС‹Р»РєРё', value: 'Р—Р°РїСЂРµС‰РµРЅС‹ СЃС‚РѕСЂРѕРЅРЅРёРµ СЃСЃС‹Р»РєРё РІ С‡Р°С‚Р°С…. РСЃРєР»СЋС‡РµРЅРёРµ вЂ” СЃСЃС‹Р»РєРё РІ #рџЋ®-РёРіСЂС‹ СЃ СЂР°Р·СЂРµС€РµРЅРёСЏ РјРѕРґРµСЂР°С‚РѕСЂР°.' },
                { name: '4пёЏвѓЈ Р“РѕР»РѕСЃРѕРІС‹Рµ РєР°РЅР°Р»С‹', value: 'Р—Р°РїСЂРµС‰С‘РЅ РєСЂРёРє, РјРёРєСЂРѕС„РѕРЅ-СЃРїР°Рј, Р·РІСѓРєРѕРІС‹Рµ СЌС„С„РµРєС‚С‹ Р±РµР· СЃРѕРіР»Р°СЃРёСЏ СѓС‡Р°СЃС‚РЅРёРєРѕРІ. РЈРІР°Р¶Р°Р№С‚Рµ С‡СѓР¶РѕРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ.' },
                { name: '5пёЏвѓЈ NSFW РєРѕРЅС‚РµРЅС‚', value: 'Р—Р°РїСЂРµС‰С‘РЅ РїРѕСЂРЅРѕРіСЂР°С„РёС‡РµСЃРєРёР№, Р¶РµСЃС‚РѕРєРёР№ Рё Р»СЋР±РѕР№ 18+ РєРѕРЅС‚РµРЅС‚. Р—Р° РЅР°СЂСѓС€РµРЅРёРµ вЂ” Р±Р°РЅ.' },
                { name: '6пёЏвѓЈ Р›РёС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ', value: 'Р—Р°РїСЂРµС‰РµРЅРѕ РїСѓР±Р»РёРєРѕРІР°С‚СЊ Р»РёС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ РґСЂСѓРіРёС… Р»СЋРґРµР№ (Р°РґСЂРµСЃР°, С‚РµР»РµС„РѕРЅС‹, С„РѕС‚Рѕ) Р±РµР· РёС… СЃРѕРіР»Р°СЃРёСЏ.' },
                { name: '7пёЏвѓЈ РњСѓР»СЊС‚РёР°РєРєР°СѓРЅС‚С‹', value: 'Р—Р°РїСЂРµС‰РµРЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ РЅРµСЃРєРѕР»СЊРєРёС… Р°РєРєР°СѓРЅС‚РѕРІ РґР»СЏ РѕР±С…РѕРґР° Р±Р°РЅР° РёР»Рё РјСѓС‚Р°.' },
                { name: '8пёЏвѓЈ РђРґРјРёРЅС‹', value: 'РЎР»РµРґСѓР№С‚Рµ РёРЅСЃС‚СЂСѓРєС†РёСЏРј РјРѕРґРµСЂР°С‚РѕСЂРѕРІ Рё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРІ. РС… СЂРµС€РµРЅРёСЏ РѕРєРѕРЅС‡Р°С‚РµР»СЊРЅС‹.' },
                { name: '9пёЏвѓЈ РњСѓР·С‹РєР°', value: 'РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±РѕС‚Р° РјСѓР·С‹РєРё С‚РѕР»СЊРєРѕ РІ РіРѕР»РѕСЃРѕРІС‹С… РєР°РЅР°Р»Р°С…. РќРµ Р·Р»РѕСѓРїРѕС‚СЂРµР±Р»СЏР№С‚Рµ РєРѕРјР°РЅРґР°РјРё.' },
                { name: 'рџ”џ Р—РґСЂР°РІС‹Р№ СЃРјС‹СЃР»', value: 'Р•СЃР»Рё РґРµР№СЃС‚РІРёРµ РјРѕР¶РµС‚ РЅР°РІСЂРµРґРёС‚СЊ СЃРµСЂРІРµСЂСѓ РёР»Рё СѓС‡Р°СЃС‚РЅРёРєР°Рј вЂ” РЅРµ РґРµР»Р°Р№С‚Рµ РµРіРѕ.' }
            )
            .setFooter({ text: 'РќР°СЂСѓС€РµРЅРёРµ РїСЂР°РІРёР» РІРµРґС‘С‚ Рє РјСѓС‚Сѓ, РєРёРєСѓ РёР»Рё Р±Р°РЅСѓ. РџСЂРёСЏС‚РЅРѕРіРѕ РѕР±С‰РµРЅРёСЏ! рџЋ®' })
            .setTimestamp();

        await rulesChannel.send({ embeds: [embed] });

        const successEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('вњ… РџСЂР°РІРёР»Р° РѕРїСѓР±Р»РёРєРѕРІР°РЅС‹!')
            .setDescription(`РџСЂР°РІРёР»Р° РѕС‚РїСЂР°РІР»РµРЅС‹ РІ ${rulesChannel}`)
            .setTimestamp();
        message.channel.send({ embeds: [successEmbed] });
    }
});

// --- РљРћРњРђРќР”Р« Р”Р›РЇ Р’РЎР•РҐ ---

commands.set('commands', {
    name: 'commands',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ РїСѓР±Р»РёС‡РЅС‹Рµ РєРѕРјР°РЅРґС‹ РІ РєР°РЅР°Р»',
    usage: '!commands #РєР°РЅР°Р»',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('вќЊ РЈРєР°Р¶Рё РєР°РЅР°Р»: !commands #рџ¤–-Р±РѕС‚-РєРѕРјР°РЅРґС‹');

        const embed1 = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџ“љ РљРћРњРђРќР”Р« РЎР•Р Р’Р•Р Рђ')
            .setDescription('Р’СЃРµ РґРѕСЃС‚СѓРїРЅС‹Рµ РєРѕРјР°РЅРґС‹ РґР»СЏ СѓС‡Р°СЃС‚РЅРёРєРѕРІ')
            .addFields(
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџЋ® РњРРќР-РР“Р Р«**', inline: false },
                { name: '`!random [С‡РёСЃР»Рѕ]`', value: 'РЈРіР°РґР°Р№ С‡РёСЃР»Рѕ РѕС‚ 1 РґРѕ 100', inline: true },
                { name: '`!rps [РєР°РјРµРЅСЊ/РЅРѕР¶РЅРёС†С‹/Р±СѓРјР°РіР°]`', value: 'РљР°РјРµРЅСЊ-РЅРѕР¶РЅРёС†С‹-Р±СѓРјР°РіР°', inline: true },
                { name: '`!roulette [С‡РёСЃР»Рѕ] [С†РІРµС‚]`', value: 'Р СѓР»РµС‚РєР° (РєСЂР°СЃРЅС‹Р№/С‡С‘СЂРЅС‹Р№/Р·РµР»С‘РЅС‹Р№)', inline: true },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџЋµ РњРЈР—Р«РљРђ** (Jockie Music)', inline: false },
                { name: '`m!play [РЅР°Р·РІР°РЅРёРµ/СЃСЃС‹Р»РєР°]`', value: 'Р’РєР»СЋС‡РёС‚СЊ РјСѓР·С‹РєСѓ', inline: true },
                { name: '`m!skip`', value: 'РџСЂРѕРїСѓСЃС‚РёС‚СЊ С‚СЂРµРє', inline: true },
                { name: '`m!stop`', value: 'РћСЃС‚Р°РЅРѕРІРёС‚СЊ РјСѓР·С‹РєСѓ', inline: true },
                { name: '`m!leave`', value: 'Р‘РѕС‚ РІС‹С…РѕРґРёС‚ РёР· РіРѕР»РѕСЃРѕРІРѕРіРѕ', inline: true },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџЋ‰ Р РђР—Р’Р›Р•Р§Р•РќРРЇ**', inline: false },
                { name: '`!poll Р’РѕРїСЂРѕСЃ | Р’Р°СЂРёР°РЅС‚1 | Р’Р°СЂРёР°РЅС‚2`', value: 'РЎРѕР·РґР°С‚СЊ РѕРїСЂРѕСЃ', inline: false },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ›ЎпёЏ РђР’РўРћ**', inline: false },
                { name: 'РђРЅС‚Рё-СЃРїР°Рј', value: '30+ СЃРѕРѕР±С‰РµРЅРёР№ Р·Р° 10 СЃРµРє = РјСѓС‚', inline: true },
                { name: 'РђРЅС‚Рё-СЃСЃС‹Р»РєРё', value: 'РЎСЃС‹Р»РєРё Р·Р°РїСЂРµС‰РµРЅС‹ (РєСЂРѕРјРµ РёРіСЂ, РјСѓР·С‹РєРё, Р±РѕС‚-РєРѕРјР°РЅРґ)', inline: true }
            )
            .setFooter({ text: 'Р‘РѕС‚: Р—РѕС…Р°РЅ РјР»Р°РґС€РёР№ вЂў РњСѓР·С‹РєР°: Jockie Music (m!play)' })
            .setTimestamp();
        await channel.send({ embeds: [embed1] });

        message.reply(`вњ… РџСѓР±Р»РёС‡РЅС‹Рµ РєРѕРјР°РЅРґС‹ РѕС‚РїСЂР°РІР»РµРЅС‹ РІ ${channel}`);
    }
});

// --- РљРћРњРђРќР”Р« Р”Р›РЇ РђР”РњРРќРћР’ ---

commands.set('modcommands', {
    name: 'modcommands',
    description: 'РћС‚РїСЂР°РІРёС‚СЊ РєРѕРјР°РЅРґС‹ РјРѕРґРµСЂР°С†РёРё РІ РєР°РЅР°Р»',
    usage: '!modcommands #РєР°РЅР°Р»',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚!');
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === (args[0] || '').replace('#', ''));
        if (!channel) return message.reply('вќЊ РЈРєР°Р¶Рё РєР°РЅР°Р»: !modcommands #вљЎ-РјРѕРґРµСЂР°С†РёСЏ-С‡Р°С‚');

        const embed1 = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('рџ›ЎпёЏ РљРћРњРђРќР”Р« РњРћР”Р•Р РђР¦РР')
            .setDescription('РўРѕР»СЊРєРѕ РґР»СЏ РјРѕРґРµСЂР°С‚РѕСЂРѕРІ Рё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРІ')
            .addFields(
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ›ЎпёЏ РњРћР”Р•Р РђР¦РРЇ**', inline: false },
                { name: '`!kick @user [РїСЂРёС‡РёРЅР°]`', value: 'Р’С‹РіРЅР°С‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°', inline: true },
                { name: '`!ban @user [РїСЂРёС‡РёРЅР°]`', value: 'Р—Р°Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°', inline: true },
                { name: '`!unban ID`', value: 'Р Р°Р·Р±Р°РЅРёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°', inline: true },
                { name: '`!mute @user [РјРёРЅСѓС‚С‹] [РїСЂРёС‡РёРЅР°]`', value: 'Р—Р°РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°', inline: true },
                { name: '`!unmute @user`', value: 'Р Р°Р·РјСѓС‚РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєР°', inline: true },
                { name: '`!clear [РєРѕР»-РІРѕ]`', value: 'РЈРґР°Р»РёС‚СЊ СЃРѕРѕР±С‰РµРЅРёСЏ', inline: true },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**вљ™пёЏ РќРђРЎРўР РћР™РљРђ РЎР•Р Р’Р•Р Рђ**', inline: false },
                { name: '`!setup`', value: 'РђРІС‚РѕСЃРѕР·РґР°РЅРёРµ СЃС‚СЂСѓРєС‚СѓСЂС‹ СЃРµСЂРІРµСЂР°', inline: true },
                { name: '`!rules`', value: 'РћРїСѓР±Р»РёРєРѕРІР°С‚СЊ РїСЂР°РІРёР»Р°', inline: true },
                { name: '`!welcome #РєР°РЅР°Р»`', value: 'РќР°СЃС‚СЂРѕРёС‚СЊ РїСЂРёРІРµС‚СЃС‚РІРёРµ', inline: true },
                { name: '`!autorole @СЂРѕР»СЊ`', value: 'РќР°СЃС‚СЂРѕРёС‚СЊ Р°РІС‚РѕСЃ СЂРѕР»СЊ', inline: true },
                { name: '`!verify #РєР°РЅР°Р»`', value: 'РќР°СЃС‚СЂРѕРёС‚СЊ РІРµСЂРёС„РёРєР°С†РёСЋ', inline: true },
                { name: '`!reactrole #РєР°РЅР°Р» | Р РѕР»СЊ:СЌРјРѕРґР·Рё`', value: 'Р РѕР»Рё РїРѕ СЂРµР°РєС†РёСЏРј', inline: false },
                { name: '`!giveaway РІСЂРµРјСЏ | РїСЂРёР· | РѕРїРёСЃР°РЅРёРµ`', value: 'Р РѕР·С‹РіСЂС‹С€ (СЃРµРєСѓРЅРґС‹)', inline: false },
                { name: '`!commands #РєР°РЅР°Р»`', value: 'РџСѓР±Р»РёС‡РЅС‹Рµ РєРѕРјР°РЅРґС‹', inline: true },
                { name: '`!modcommands #РєР°РЅР°Р»`', value: 'Р­С‚РѕС‚ СЃРїРёСЃРѕРє', inline: true },
                { name: '`!gamenews`', value: 'РЎРѕР·РґР°С‚СЊ РєР°С‚РµРіРѕСЂРёСЋ "рџЋ® РР“Р РћР’Р«Р• РќРћР’РћРЎРўР"', inline: true },
                { name: '`!news`', value: 'РћР±РЅРѕРІРёС‚СЊ РЅРѕРІРѕСЃС‚Рё РІСЂСѓС‡РЅСѓСЋ', inline: true },
                { name: '`!dellolcommands`', value: 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р» lol-РєРѕРјР°РЅРґС‹', inline: true },
                { name: 'в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ', value: '**рџ›ЎпёЏ РђР’РўРћРњРђРўРР§Р•РЎРљР**', inline: false },
                { name: 'Р›РѕРіРёСЂРѕРІР°РЅРёРµ', value: 'РЈРґР°Р»РµРЅРёРµ/СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ РІ #рџ“‹-Р»РѕРіРё', inline: true },
                { name: 'РџСЂРѕС‰Р°РЅРёРµ', value: 'РЎРѕРѕР±С‰РµРЅРёРµ РєРѕРіРґР° РєС‚Рѕ-С‚Рѕ РІС‹С€РµР»', inline: true }
            )
            .setFooter({ text: 'РўРѕР»СЊРєРѕ РґР»СЏ РјРѕРґРµСЂР°С‚РѕСЂРѕРІ!' })
            .setTimestamp();
        await channel.send({ embeds: [embed1] });

        message.reply(`вњ… РљРѕРјР°РЅРґС‹ РјРѕРґРµСЂР°С†РёРё РѕС‚РїСЂР°РІР»РµРЅС‹ РІ ${channel}`);
    }
});

// --- РЎРџР РЇРўРђРўР¬ РњРћР” РљРђРќРђР›Р« ---

commands.set('lockmod', {
    name: 'lockmod',
    description: 'РЎРїСЂСЏС‚Р°С‚СЊ РјРѕРґРµСЂР°С‚РѕСЂСЃРєРёРµ РєР°РЅР°Р»С‹ РѕС‚ РѕР±С‹С‡РЅС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ',
    usage: '!lockmod',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚!');
        }

        const everyone = message.guild.roles.everyone;
        const modChannels = ['рџ“‹-Р»РѕРіРё', 'вљЎ-РјРѕРґРµСЂР°С†РёСЏ-С‡Р°С‚'];

        for (const name of modChannels) {
            const channel = message.guild.channels.cache.find(ch => ch.name === name);
            if (!channel) continue;

            await channel.permissionOverwrites.edit(everyone, {
                ViewChannel: false,
            }).catch(() => {});

            // Р”РѕР±Р°РІР»СЏРµРј РїСЂР°РІР° РґР»СЏ Admin Рё Moderator РµСЃР»Рё РёС… СЂРѕР»Рё РµСЃС‚СЊ
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
            .setTitle('рџ”’ РњРѕРґРµСЂР°С‚РѕСЂСЃРєРёРµ РєР°РЅР°Р»С‹ СЃРєСЂС‹С‚С‹')
            .setDescription('РљР°РЅР°Р»С‹ **#рџ“‹-Р»РѕРіРё** Рё **#вљЎ-РјРѕРґРµСЂР°С†РёСЏ-С‡Р°С‚** С‚РµРїРµСЂСЊ РІРёРґРЅС‹ С‚РѕР»СЊРєРѕ РјРѕРґРµСЂР°С‚РѕСЂР°Рј Рё Р°РґРјРёРЅР°Рј.')
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- РЈР”РђР›РРўР¬ РўРРљР•РўР« ---

commands.set('deltickets', {
    name: 'deltickets',
    description: 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р» С‚РёРєРµС‚РѕРІ',
    usage: '!deltickets',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚!');
        }

        const channel = message.guild.channels.cache.find(ch => ch.name === 'рџЋ«-С‚РёРєРµС‚С‹');
        if (!channel) return message.reply('вќЊ РљР°РЅР°Р» С‚РёРєРµС‚РѕРІ РЅРµ РЅР°Р№РґРµРЅ!');

        await channel.delete().catch(() => {});
        message.reply('вњ… РљР°РЅР°Р» С‚РёРєРµС‚РѕРІ СѓРґР°Р»С‘РЅ!');
    }
});

// --- РЈР”РђР›РРўР¬ LOL РљРћРњРђРќР”Р« ---

commands.set('dellolcommands', {
    name: 'dellolcommands',
    description: 'РЈРґР°Р»РёС‚СЊ РєР°РЅР°Р» lol-РєРѕРјР°РЅРґС‹',
    usage: '!dellolcommands',
    async execute(message) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ!');
        }

        const channel = message.guild.channels.cache.find(ch => ch.name.includes('lol-komandy') || ch.name.includes('lol-РєРѕРјР°РЅРґС‹'));
        if (!channel) return message.reply('вќЊ РљР°РЅР°Р» РЅРµ РЅР°Р№РґРµРЅ!');

        await channel.delete().catch(() => {});
        message.reply('вњ… РљР°РЅР°Р» СѓРґР°Р»С‘РЅ!');
    }
});

// --- РџРћРњРћР©Р¬ ---

commands.set('help', {
    name: 'help',
    description: 'РџРѕРєР°Р·Р°С‚СЊ РІСЃРµ РєРѕРјР°РЅРґС‹',
    execute(message) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџ“љ РљРѕРјР°РЅРґС‹ Р±РѕС‚Р°')
            .setDescription('Р’СЃРµ РґРѕСЃС‚СѓРїРЅС‹Рµ РєРѕРјР°РЅРґС‹:')
            .addFields(
                { name: 'рџ›ЎпёЏ РњРѕРґРµСЂР°С†РёСЏ', value: '`!kick` `!ban` `!unban` `!mute` `!unmute` `!clear`' },
                { name: 'рџЋ® РњРёРЅРё-РёРіСЂС‹', value: '`!random` `!rps` `!roulette`' },
                { name: 'рџЋµ РњСѓР·С‹РєР°', value: 'РСЃРїРѕР»СЊР·СѓР№ `m!play` (Jockie Music Р±РѕС‚)' },
                { name: 'рџЋ‰ Р РѕР·С‹РіСЂС‹С€Рё', value: '`!giveaway`' },
                { name: 'рџ“Љ РћРїСЂРѕСЃС‹', value: '`!poll`' },
                { name: 'рџЋ­ Р РѕР»Рё', value: '`!reactrole` `!verify`' },
                { name: 'вљ™пёЏ РЎРµСЂРІРµСЂ', value: '`!setup` `!rules` `!welcome` `!autorole` `!verify` `!commands` `!modcommands` `!help`' },
                { name: 'рџЋ® РќРѕРІРѕСЃС‚Рё', value: '`!gamenews` `!news`' },
                { name: 'вљ”пёЏ League of Legends', value: '`!tierlist` `!top` `!builds` `!rating` `!counter` `!lolnews` `!lolhelp`' },
                { name: 'рџ¤– РђРІС‚Рѕ', value: 'РђРЅС‚Рё-СЃРїР°Рј, РђРЅС‚Рё-СЃСЃС‹Р»РєРё, Р›РѕРіРёСЂРѕРІР°РЅРёРµ, РџСЂРёРІРµС‚СЃС‚РІРёРµ/РџСЂРѕС‰Р°РЅРёРµ' }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// --- Р РћР›Р РџРћ Р Р•РђРљР¦РРЇРњ ---

commands.set('reactrole', {
    name: 'reactrole',
    description: 'РЎРѕР·РґР°С‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЃ СЂРѕР»СЏРјРё РїРѕ СЂРµР°РєС†РёСЏРј',
    usage: '!reactrole #РєР°РЅР°Р» | Р РѕР»СЊ1:СЌРјРѕРґР·Рё | Р РѕР»СЊ2:СЌРјРѕРґР·Рё',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ РЅР°СЃС‚СЂР°РёРІР°С‚СЊ СЂРѕР»Рё РїРѕ СЂРµР°РєС†РёСЏРј!');
        }

        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('вќЊ Р¤РѕСЂРјР°С‚: !reactrole # РєР°РЅР°Р» | Р РѕР»СЊ1:рџЋ­ | Р РѕР»СЊ2:рџЋ®');

        const channelMention = parts[0];
        const channel = message.mentions.channels.first() || message.guild.channels.cache.find(ch => ch.name === channelMention.replace('#', ''));
        if (!channel) return message.reply('вќЊ РљР°РЅР°Р» РЅРµ РЅР°Р№РґРµРЅ!');

        const rolePairs = parts.slice(1);
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('рџЋ­ Р’С‹Р±РµСЂРё СЂРѕР»СЊ!')
            .setDescription('РќР°Р¶РјРё РЅР° СЌРјРѕРґР·Рё С‡С‚РѕР±С‹ РїРѕР»СѓС‡РёС‚СЊ СЂРѕР»СЊ:')
            .setTimestamp();

        const description = [];
        for (const pair of rolePairs) {
            const [roleName, emoji] = pair.split(':').map(s => s.trim());
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (role) {
                description.push(`${emoji} вЂ” ${role}`);
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

        message.reply('вњ… Р РѕР»Рё РїРѕ СЂРµР°РєС†РёСЏРј СЃРѕР·РґР°РЅС‹!');
    }
});

// --- Р РћР—Р«Р“Р Р«РЁР ---

const giveaways = new Map();

commands.set('giveaway', {
    name: 'giveaway',
    description: 'РЎРѕР·РґР°С‚СЊ СЂРѕР·С‹РіСЂС‹С€',
    usage: '!giveaway 60 | РџСЂРёР· | РћРїРёСЃР°РЅРёРµ',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('вќЊ РўРѕР»СЊРєРѕ Р°РґРјРёРЅ РјРѕР¶РµС‚ СЃРѕР·РґР°РІР°С‚СЊ СЂРѕР·С‹РіСЂС‹С€Рё!');
        }

        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('вќЊ Р¤РѕСЂРјР°С‚: !giveaway 60 | РџСЂРёР· | РћРїРёСЃР°РЅРёРµ');

        const time = parseInt(parts[0]) * 1000;
        const prize = parts[1];
        const description = parts[2] || 'РЈС‡Р°СЃС‚РІСѓР№!';

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('рџЋ‰ Р РћР—Р«Р“Р Р«РЁ!')
            .setDescription(`**РџСЂРёР·:** ${prize}\n\n${description}\n\nвЏ° Р—Р°РєР°РЅС‡РёРІР°РµС‚СЃСЏ С‡РµСЂРµР·: ${Math.floor(time / 60000)} РјРёРЅ.`)
            .setFooter({ text: 'РќР°Р¶РјРё рџЋ‰ С‡С‚РѕР±С‹ СѓС‡Р°СЃС‚РІРѕРІР°С‚СЊ!' })
            .setTimestamp();

        const msg = await message.channel.send({ embeds: [embed] });
        await msg.react('рџЋ‰');

        giveaways.set(msg.id, {
            prize,
            endTime: Date.now() + time,
            messageId: msg.id,
            channelId: message.channel.id,
            guildId: message.guild.id,
        });

        message.reply(`вњ… Р РѕР·С‹РіСЂС‹С€ СЃРѕР·РґР°РЅ! Р—Р°РєР°РЅС‡РёРІР°РµС‚СЃСЏ С‡РµСЂРµР· ${Math.floor(time / 60000)} РјРёРЅ.`);
    }
});

// --- РћРџР РћРЎР« ---

commands.set('poll', {
    name: 'poll',
    description: 'РЎРѕР·РґР°С‚СЊ РѕРїСЂРѕСЃ',
    usage: '!poll Р’РѕРїСЂРѕСЃ | Р’Р°СЂРёР°РЅС‚1 | Р’Р°СЂРёР°РЅС‚2',
    async execute(message, args) {
        const fullArgs = args.join(' ');
        const parts = fullArgs.split('|').map(p => p.trim());
        if (parts.length < 2) return message.reply('вќЊ Р¤РѕСЂРјР°С‚: !poll Р’РѕРїСЂРѕСЃ | Р’Р°СЂРёР°РЅС‚1 | Р’Р°СЂРёР°РЅС‚2');

        const question = parts[0];
        const options = parts.slice(1);
        const emojis = ['1пёЏвѓЈ', '2пёЏвѓЈ', '3пёЏвѓЈ', '4пёЏвѓЈ', '5пёЏвѓЈ', '6пёЏвѓЈ', '7пёЏвѓЈ', '8пёЏвѓЈ', '9пёЏвѓЈ', 'рџ”џ'];

        const description = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n');
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`рџ“Љ ${question}`)
            .setDescription(description)
            .setFooter({ text: `РћРїСЂРѕСЃ РѕС‚ ${message.author.tag}` })
            .setTimestamp();

        const msg = await message.channel.send({ embeds: [embed] });

        for (let i = 0; i < options.length; i++) {
            await msg.react(emojis[i]);
        }

        message.delete().catch(() => {});
    }
});

// --- РџР РћР©РђРќРР• ---

// --- РђР’РўРћ-РђРќРњРђРў (Р Р•РђРљР¦РР) ---

// ==================== РЎРћР‘Р«РўРРЇ ====================

client.on('ready', () => {
    console.log(`вњ… Р‘РѕС‚ ${client.user.tag} Р·Р°РїСѓС‰РµРЅ!`);
    client.user.setActivity('!help | РЎРµСЂРІРµСЂ ZOHAN', { type: ActivityType.Playing });

    // Р—Р°РїСѓСЃРє Telegram Р±РѕС‚Р° (РµСЃР»Рё РЅР°СЃС‚СЂРѕРµРЅ)
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
        console.log('вњ… Telegram Р±РѕС‚ Р·Р°РїСѓС‰РµРЅ!');

        // РћР±СЂР°Р±РѕС‚РєР° СЃРѕРѕР±С‰РµРЅРёР№ РёР· Telegram в†’ Discord
        telegramBot.on('message', async (msg) => {
            if (msg.from.is_bot) return;

            // РС‰РµРј РєР°РЅР°Р» РґР»СЏ Telegram СЃРѕРѕР±С‰РµРЅРёР№
            for (const [, guild] of client.guilds.cache) {
                const tgChannel = guild.channels.cache.find(ch =>
                    ch.name.includes('telegram') || ch.name.includes('tg')
                );
                if (tgChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x0099ff)
                        .setTitle('рџ“± Telegram')
                        .setDescription(`**${msg.from.first_name || msg.from.username}**: ${msg.text}`)
                        .setFooter({ text: 'Telegram в†’ Discord' })
                        .setTimestamp();
                    await tgChannel.send({ embeds: [embed] }).catch(() => {});
                }
            }
        });

        // РћС‚РїСЂР°РІР»СЏРµРј РїСЂРёРІРµС‚СЃС‚РІРёРµ
        sendToTelegram('вњ… Р‘РѕС‚ Discord Р·Р°РїСѓС‰РµРЅ Рё СЃРІСЏР·Р°РЅ СЃ СЃРµСЂРІРµСЂРѕРј!');
    }

    // ==================== Р РђРЎРџРРЎРђРќРР• РћР‘РќРћР’Р›Р•РќРР™ ====================

    // Р¤СѓРЅРєС†РёСЏ РїСЂРѕРІРµСЂРєРё РІСЂРµРјРµРЅРё
    function isUpdateHour(hours) {
        const now = new Date().getHours();
        return hours.includes(now);
    }

    // рџ“° РР“Р РћР’Р«Р• РќРћР’РћРЎРўР - РєР°Р¶РґС‹Рµ 4 С‡Р°СЃР° (10:00, 14:00, 18:00, 22:00)
    const newsHours = [10, 14, 18, 22];
    console.log(`рџ“° РРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё: ${newsHours.join(':00, ')}:00`);

    // вљ”пёЏ LOL TIER LIST - РєР°Р¶РґС‹Рµ 6 С‡Р°СЃРѕРІ (09:00, 15:00, 21:00)
    const tierListHours = [9, 15, 21];
    console.log(`вљ”пёЏ LOL Tier List: ${tierListHours.join(':00, ')}:00`);

    // рџ›Ў LOL РЎР‘РћР РљР - РєР°Р¶РґС‹Рµ 8 С‡Р°СЃРѕРІ (10:00, 18:00)
    const buildsHours = [10, 18];
    console.log(`рџ›Ў LOL РЎР±РѕСЂРєРё: ${buildsHours.join(':00, ')}:00`);

    // рџЏ† LOL Р Р•Р™РўРРќР“ - РєР°Р¶РґС‹Рµ 12 С‡Р°СЃРѕРІ (12:00, 00:00)
    const ratingHours = [0, 12];
    console.log(`рџЏ† LOL Р РµР№С‚РёРЅРі: ${ratingHours.join(':00, ')}:00`);

    // РџСЂРѕРІРµСЂСЏРµРј РєР°Р¶РґС‹Рµ 30 РјРёРЅСѓС‚
    setInterval(async () => {
        const currentHour = new Date().getHours();
        const currentMinute = new Date().getMinutes();

        // Очистка дедупликации LOL раз в сутки (в 00:05)
        if (currentHour === 0 && currentMinute < 5) {
            publishedLoLNews.clear();
            console.log('Очищен publishedLoLNews');
        }
        console.log(`вЏ° РџСЂРѕРІРµСЂСЏСЋ РІСЂРµРјСЏ: ${currentHour}:00`);

        // рџ”ґ РџСЂРѕРІРµСЂСЏРµРј Twitch СЃС‚СЂРёРјС‹ РєР°Р¶РґС‹Рµ 5 РјРёРЅСѓС‚
        // рџ“° РРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё
        if (newsHours.includes(currentHour)) {
            console.log('рџ“° РћР±РЅРѕРІР»СЏСЋ РёРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё...');
            await postNewsToChannel(client);
        }

        // рџЋ® LOL РЅРѕРІРѕСЃС‚Рё (РІ РєР°РЅР°Р» lol-РЅРѕРІРѕСЃС‚Рё)
        if (newsHours.includes(currentHour)) {
            console.log('рџЋ® РћР±РЅРѕРІР»СЏСЋ LOL РЅРѕРІРѕСЃС‚Рё...');
            for (const [, guild] of client.guilds.cache) {
                const lolNewsChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-РЅРѕРІРѕСЃС‚Рё') || ch.name.includes('lol-novosti')
                );
                if (lolNewsChannel) {
                    console.log('рџЋ® РљР°РЅР°Р» LOL РЅРѕРІРѕСЃС‚РµР№ РЅР°Р№РґРµРЅ:', lolNewsChannel.name);
                    const lolNews = await fetchLoLNews();
                    console.log('рџЋ® РџРѕР»СѓС‡РµРЅРѕ LOL РЅРѕРІРѕСЃС‚РµР№:', lolNews.length);
                                        // Собираем embed в массив, проверяем дубли
                    const embeds = [];
                    for (const item of lolNews) {
                        const newsId = `${item.source}-${item.title}`;
                        if (publishedLoLNews.has(newsId)) continue;

                        const embed = new EmbedBuilder()
                            .setColor(0xffd700)
                            .setTitle(`${item.emoji} ${item.title}`)
                            .setDescription(item.content.substring(0, 400) + (item.content.length > 400 ? "... ..." : ""))
                            .addFields(
                                { name: "Источник", value: item.source, inline: true }
                            )
                            .setURL(item.link)
                            .setTimestamp();
                        if (item.image) {
                            try { embed.setImage(item.image); } catch (e) {}
                        }
                        embeds.push(embed);
                        publishedLoLNews.add(newsId);
                    }
                    // Отправляем пакетом по 10 (1 уведомление)
                    for (let i = 0; i < embeds.length; i += 10) {
                        const batch = embeds.slice(i, i + 10);
                        await lolNewsChannel.send({ embeds: batch }).catch(() => {});
                        if (i + 10 < embeds.length) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                    console.log(`✅ LOL: опубликовано ${embeds.length} новостей (${Math.ceil(embeds.length / 10)} сообщений)`);
                }
            }
        }


        // вљ”пёЏ LOL Tier List (РІ РєР°РЅР°Р» lol-РіР°Р№РґС‹)
        if (tierListHours.includes(currentHour)) {
            console.log('вљ”пёЏ РћР±РЅРѕРІР»СЏСЋ LOL Tier List...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-РіР°Р№РґС‹') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('вљ”пёЏ РљР°РЅР°Р» РЅР°Р№РґРµРЅ:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createTierListEmbed()] }).catch(() => {});
                }
            }
        }

        // рџ›Ў LOL РЎР±РѕСЂРєРё (РІ РєР°РЅР°Р» lol-РіР°Р№РґС‹)
        if (buildsHours.includes(currentHour)) {
            console.log('рџ›Ў РћР±РЅРѕРІР»СЏСЋ LOL РЎР±РѕСЂРєРё...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-РіР°Р№РґС‹') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('рџ›Ў РљР°РЅР°Р» РЅР°Р№РґРµРЅ:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createBuildsEmbed('mid')] }).catch(() => {});
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await lolGuidesChannel.send({ embeds: [createBuildsEmbed('adc')] }).catch(() => {});
                }
            }
        }

        // рџЏ† LOL Р РµР№С‚РёРЅРі (РІ РєР°РЅР°Р» lol-РіР°Р№РґС‹)
        if (ratingHours.includes(currentHour)) {
            console.log('рџЏ† РћР±РЅРѕРІР»СЏСЋ LOL Р РµР№С‚РёРЅРі...');
            for (const [, guild] of client.guilds.cache) {
                const lolGuidesChannel = guild.channels.cache.find(ch => 
                    ch.name.includes('lol-РіР°Р№РґС‹') || ch.name.includes('lol-gajdy')
                );
                if (lolGuidesChannel) {
                    console.log('рџЏ† РљР°РЅР°Р» РЅР°Р№РґРµРЅ:', lolGuidesChannel.name);
                    await lolGuidesChannel.send({ embeds: [createRatingEmbed()] }).catch(() => {});
                }
            }
        }

    }, 30 * 60 * 1000); // РџСЂРѕРІРµСЂСЏРµРј РєР°Р¶РґС‹Рµ 30 РјРёРЅСѓС‚
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.PREFIX || '!')) return;

    const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args);
    } catch (error) {
        console.error(error);
        message.reply('вќЊ РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° РїСЂРё РІС‹РїРѕР»РЅРµРЅРёРё РєРѕРјР°РЅРґС‹!');
    }
});

// РџСЂРёРІРµС‚СЃС‚РІРёРµ РЅРѕРІС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ
client.on('guildMemberAdd', async (member) => {
    const channel = member.guild.channels.cache.find(ch => ch.name === process.env.WELCOME_CHANNEL);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('рџ‘‹ Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ!')
            .setDescription(`РџСЂРёРІРµС‚, ${member}! Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РЅР° СЃРµСЂРІРµСЂ **${member.guild.name}**!`)
            .addFields(
                { name: 'рџЋ® РРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё', value: 'Р—Р°РіР»СЏРЅРё РІ РєР°РЅР°Р» **#рџЋ®-РЅРѕРІРѕСЃС‚Рё** вЂ” С‚Р°Рј РїРѕСЃР»РµРґРЅРёРµ РёРіСЂРѕРІС‹Рµ РЅРѕРІРѕСЃС‚Рё!', inline: false },
                { name: 'вљ”пёЏ LOL Р“Р°Р№РґС‹', value: 'РРіСЂР°РµС€СЊ РІ LOL? РЎРјРѕС‚СЂРё **#вљ”пёЏ-lol-РіР°Р№РґС‹** вЂ” Tier List, СЃР±РѕСЂРєРё, СЂРµР№С‚РёРЅРіРё!', inline: false },
                { name: 'рџ“њ РљРѕРјР°РЅРґС‹', value: 'РќР°РїРёС€Рё `!help` С‡С‚РѕР±С‹ СѓР·РЅР°С‚СЊ РІСЃРµ РєРѕРјР°РЅРґС‹ Р±РѕС‚Р°!', inline: false },
                { name: 'РЈС‡Р°СЃС‚РЅРёРєРѕРІ', value: `${member.guild.memberCount}`, inline: true },
                { name: 'РЎРѕР·РґР°РЅ', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
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

// РџР РћР©РђРќРР• СѓС‡Р°СЃС‚РЅРёРєРѕРІ
client.on('guildMemberRemove', async (member) => {
    const logChannel = member.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('рџ‘‹ РЈС‡Р°СЃС‚РЅРёРє РїРѕРєРёРЅСѓР» СЃРµСЂРІРµСЂ')
            .setDescription(`**${member.user.tag}** РІС‹С€РµР» СЃ СЃРµСЂРІРµСЂР°`)
            .addFields(
                { name: 'РЈС‡Р°СЃС‚РЅРёРєРѕРІ РѕСЃС‚Р°Р»РѕСЃСЊ', value: `${member.guild.memberCount}`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        logChannel.send({ embeds: [embed] });
    }
});

// Р›РћР“РР РћР’РђРќРР•: СѓРґР°Р»С‘РЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ
client.on('messageDelete', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    const logChannel = message.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('рџ—‘пёЏ РЎРѕРѕР±С‰РµРЅРёРµ СѓРґР°Р»РµРЅРѕ')
        .addFields(
            { name: 'РђРІС‚РѕСЂ', value: `${message.author.tag}`, inline: true },
            { name: 'РљР°РЅР°Р»', value: `${message.channel}`, inline: true },
            { name: 'РљРѕРЅС‚РµРЅС‚', value: message.content.substring(0, 1000) || 'РќРµС‚ С‚РµРєСЃС‚Р°' }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// Р›РћР“РР РћР’РђРќРР•: edited СЃРѕРѕР±С‰РµРЅРёСЏ
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.author.bot) return;
    if (!oldMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    const logChannel = oldMessage.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('вњЏпёЏ РЎРѕРѕР±С‰РµРЅРёРµ РёР·РјРµРЅРµРЅРѕ')
        .addFields(
            { name: 'РђРІС‚РѕСЂ', value: `${oldMessage.author.tag}`, inline: true },
            { name: 'РљР°РЅР°Р»', value: `${oldMessage.channel}`, inline: true },
            { name: 'Р‘С‹Р»Рѕ', value: oldMessage.content.substring(0, 500) || 'РќРµС‚ С‚РµРєСЃС‚Р°' },
            { name: 'РЎС‚Р°Р»Рѕ', value: newMessage.content.substring(0, 500) || 'РќРµС‚ С‚РµРєСЃС‚Р°' }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// Р›РћР“РР РћР’РђРќРР•: Р±Р°РЅ/РєРёРє
client.on('guildBanAdd', async (ban) => {
    const logChannel = ban.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('рџ”Ё РЈС‡Р°СЃС‚РЅРёРє Р·Р°Р±Р°РЅРµРЅ')
        .addFields(
            { name: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ', value: `${ban.user.tag}`, inline: true },
            { name: 'РџСЂРёС‡РёРЅР°', value: ban.reason || 'РќРµ СѓРєР°Р·Р°РЅР°', inline: true }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// Р›РћР“РР РћР’РђРќРР•: СЂР°Р·Р±Р°РЅ
client.on('guildBanRemove', async (ban) => {
    const logChannel = ban.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('вњ… РЈС‡Р°СЃС‚РЅРёРє СЂР°Р·Р±Р°РЅРµРЅ')
        .addFields(
            { name: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ', value: `${ban.user.tag}`, inline: true }
        )
        .setTimestamp();
    logChannel.send({ embeds: [embed] });
});

// РђРќРўР-РЎРџРђРњ Рё РђРќРўР-РЎРЎР«Р›РљР
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.member) return;
    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    const userId = message.author.id;
    const now = Date.now();

    // РђРЅС‚Рё-СЃРїР°Рј
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
            const warn = await message.channel.send(`вљ пёЏ ${message.author}, Р·Р°РјСѓС‡РµРЅ РЅР° 1 РјРёРЅСѓС‚Сѓ Р·Р° СЃРїР°Рј!`);
            setTimeout(() => {
                if (mute) message.member.roles.remove(mute).catch(() => {});
            }, 60000);
            setTimeout(() => warn.delete(), 8000);

            const logChannel = message.guild.channels.cache.find(ch => ch.name === 'рџ“‹-Р»РѕРіРё');
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle('вљ пёЏ РђРЅС‚Рё-СЃРїР°Рј')
                    .setDescription(`${message.author.tag} Р·Р°РјСѓС‡РµРЅ РЅР° 1 РјРёРЅСѓС‚Сѓ Р·Р° СЃРїР°Рј`)
                    .setTimestamp();
                logChannel.send({ embeds: [embed] });
            }
        } catch (err) {}
        return;
    }

    // РџСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ Р·Р° СЃРїР°Рј
    if (recent.length === SPAM_LIMIT - 1) {
        const warn = await message.channel.send(`вљ пёЏ ${message.author}, Р·Р°РјРµРґР»Рё! РЎР»РµРґСѓСЋС‰РµРµ СЃРѕРѕР±С‰РµРЅРёРµ = РјСѓС‚.`);
        setTimeout(() => warn.delete(), 4000);
    }

    // РђРЅС‚Рё-СЃСЃС‹Р»РєРё (СЂР°Р·СЂРµС€РµРЅС‹ РІ РєР°РЅР°Р»Р°С…: РёРіСЂС‹, РјСѓР·С‹РєР°, Р±РѕС‚-РєРѕРјР°РЅРґС‹)
    const allowedChannels = ['рџЋ®-РёРіСЂС‹', 'рџЋµ-РјСѓР·С‹РєР°', 'рџ‘‹-РѕР±С‰РµРЅРёРµ', 'РѕР±С‰РµРµ'];
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/i;
    if (urlRegex.test(message.content) && !allowedChannels.includes(message.channel.name)) {
        try {
            await message.delete();
            const warn = await message.channel.send(`рџљ« ${message.author}, СЃСЃС‹Р»РєРё Р·Р°РїСЂРµС‰РµРЅС‹ РІ СЌС‚РѕРј РєР°РЅР°Р»Рµ!`);
            setTimeout(() => warn.delete(), 3000);
        } catch (err) {}
    }
});

// Р Р•РђРљР¦РР: РѕР±СЂР°Р±РѕС‚РєР° Reaction Roles Рё Р’РµСЂРёС„РёРєР°С†РёСЏ
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.partial) await reaction.message.fetch();

    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);

    // Р’РµСЂРёС„РёРєР°С†РёСЏ
    if (reaction.emoji.name === 'вњ…') {
        const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
        if (verifiedRole && !member.roles.cache.has(verifiedRole.id)) {
            await member.roles.add(verifiedRole).catch(() => {});
            const ch = guild.channels.cache.find(ch => ch.name === 'рџ‘‹-РѕР±С‰РµРЅРёРµ');
            if (ch) ch.send(`вњ… ${member} РІРµСЂРёС„РёС†РёСЂРѕРІР°РЅ! Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ!`).then(m => setTimeout(() => m.delete(), 5000));
        }
    }
});

// Р РћР—Р«Р“Р Р«РЁР: РѕР±СЂР°Р±РѕС‚РєР° С‚Р°Р№РјРµСЂРѕРІ
setInterval(async () => {
    for (const [id, giveaway] of giveaways) {
        if (Date.now() >= giveaway.endTime) {
            const guild = client.guilds.cache.get(giveaway.guildId);
            if (!guild) { giveaways.delete(id); continue; }

            const channel = guild.channels.cache.get(giveaway.channelId);
            if (!channel) { giveaways.delete(id); continue; }

            try {
                const msg = await channel.messages.fetch(giveaway.messageId);
                const reactions = msg.reactions.cache.get('рџЋ‰');
                if (!reactions) {
                    await channel.send('рџЋ‰ Р РѕР·С‹РіСЂС‹С€ Р·Р°РІРµСЂС€С‘РЅ, РЅРѕ РЅРёРєС‚Рѕ РЅРµ СѓС‡Р°СЃС‚РІРѕРІР°Р»!');
                    giveaways.delete(id);
                    continue;
                }

                const users = await reactions.users.fetch();
                const participants = users.filter(u => !u.bot);
                if (participants.size === 0) {
                    await channel.send('рџЋ‰ Р РѕР·С‹РіСЂС‹С€ Р·Р°РІРµСЂС€С‘РЅ, РЅРѕ РЅРёРєС‚Рѕ РЅРµ СѓС‡Р°СЃС‚РІРѕРІР°Р»!');
                } else {
                    const winner = participants.random();
                    const embed = new EmbedBuilder()
                        .setColor(0xffd700)
                        .setTitle('рџЋ‰ РџРћР‘Р•Р”РРўР•Р›Р¬!')
                        .setDescription(`**${winner}** РІС‹РёРіСЂР°Р» **${giveaway.prize}**!`);
                    await channel.send({ embeds: [embed] });
                }
            } catch (err) {}

            giveaways.delete(id);
        }
    }
}, 10000);

// ==================== Р—РђРџРЈРЎРљ ====================

client.login(process.env.TOKEN);


