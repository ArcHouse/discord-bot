const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Player } = require('discord-player');
const dotenv = require('dotenv');

dotenv.config();

// Настройка прокси если указан
const clientOptions = {
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
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
            const searchResult = await player.search(query, { requestedBy: message.author });

            if (!searchResult || !searchResult.tracks.length) {
                return message.reply('❌ Ничего не нашёл!');
            }

            const queue = player.nodes.create(message.guild, {
                metadata: { channel: message.channel },
                leaveOnEmpty: true,
                leaveOnEnd: true,
            });

            try {
                if (!queue.connection) await queue.connect(voiceChannel);
            } catch (err) {
                player.nodes.delete(message.guild);
                return message.reply('❌ Не могу подключиться к голосовому каналу!');
            }

            await queue.addTrack(searchResult.tracks[0]);

            if (!queue.isPlaying()) {
                await queue.play();
            }

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🎵 Добавлено в очередь')
                .addFields(
                    { name: 'Трек', value: searchResult.tracks[0].title, inline: true },
                    { name: 'Длительность', value: searchResult.tracks[0].duration, inline: true },
                    { name: 'Автор', value: searchResult.tracks[0].author, inline: true }
                )
                .setThumbnail(searchResult.tracks[0].thumbnail)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            message.reply('❌ Ошибка при воспроизведении!');
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

        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('❌ Укажи канал: !welcome #general');

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
                { name: '👋 Настройка', value: '`!welcome` `!autorole` `!help`' }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

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
    if (!channel) return;

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

    // Выдача автос роли
    const roleId = process.env.AUTOROLE;
    if (roleId && roleId !== '@Member') {
        const role = member.guild.roles.cache.get(roleId);
        if (role) {
            try {
                await member.roles.add(role);
            } catch (err) {
                console.error('Не удалось выдать автос роль:', err);
            }
        }
    }
});

// ==================== ЗАПУСК ====================

client.login(process.env.TOKEN);
