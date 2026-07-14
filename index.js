const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Player } = require('discord-player');
const { extractors, DefaultExtractors } = require('@discord-player/extractor');
const dotenv = require('dotenv');

dotenv.config();

// Антиспам хранилище
const spamTracker = new Map();
const SPAM_LIMIT = 5;
const SPAM_TIME = 5000;

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

// Логирование событий плеера
player.events.on('playerStart', (queue, track) => {
    console.log(`🎵 Воспроизведение: ${track.title}`);
});

player.events.on('playerError', (queue, error, track) => {
    console.error(`❌ Ошибка плеера: ${error.message}`);
    console.error(error.stack);
});

player.events.on('error', (queue, error) => {
    console.error(`❌ Ошибка очереди: ${error.message}`);
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
                { name: '⚙️ Сервер', value: '`!setup` `!rules` `!welcome` `!autorole` `!help`' },
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
            const warn = await message.channel.send(`⚠️ ${message.author}, замучен за спам! (${SPAM_LIMIT} сообщений за ${SPAM_TIME / 1000} сек)`);
            setTimeout(() => warn.delete(), 5000);

            const logChannel = message.guild.channels.cache.find(ch => ch.name === '📋-логи');
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle('⚠️ Анти-спам')
                    .setDescription(`${message.author.tag} замучен за спам`)
                    .setTimestamp();
                logChannel.send({ embeds: [embed] });
            }
        } catch (err) {}
        return;
    }

    // Анти-ссылки
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/i;
    if (urlRegex.test(message.content)) {
        try {
            await message.delete();
            const warn = await message.channel.send(`🚫 ${message.author}, ссылки запрещены!`);
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
