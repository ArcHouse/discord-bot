'use strict';

const { timingSafeEqual, randomBytes } = require('node:crypto');
const ID = /^\d{17,20}$/;
const ACTIONS = new Set(['create_channel', 'edit_channel', 'create_role', 'edit_role', 'set_channel_permissions', 'send_message', 'edit_message']);
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
function keys(obj, allowed) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k => !allowed.includes(k))) throw fail('INVALID_FIELDS');
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) throw fail('INVALID_ID'); return value; }
function text(value, max, empty = false) {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw fail('INVALID_TEXT');
    return value;
}
function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw fail('INVALID_NUMBER'); return value; }
function bits(value) { if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw fail('INVALID_PERMISSIONS'); return value; }

function validatePlan(input) {
    keys(input, ['action', 'targetId', 'data']);
    if (!ACTIONS.has(input.action)) throw fail('UNKNOWN_ACTION');
    const data = input.data;
    const plan = { action: input.action, data: {} };
    if (!input.action.startsWith('create_')) plan.targetId = id(input.targetId);
    else if (input.targetId !== undefined) throw fail('INVALID_FIELDS');
    if (['create_channel', 'edit_channel'].includes(input.action)) {
        keys(data, input.action === 'create_channel' ? ['name', 'type', 'parent', 'topic', 'rateLimitPerUser', 'bitrate', 'userLimit', 'position'] : ['name', 'parent', 'topic', 'rateLimitPerUser', 'bitrate', 'userLimit', 'position']);
        for (const [key, value] of Object.entries(data)) {
            if (key === 'name') plan.data[key] = text(value, 100);
            if (key === 'topic') plan.data[key] = text(value, 1024, true);
            if (key === 'parent') plan.data[key] = value === null ? null : id(value);
            if (key === 'type') { if (![0, 2, 4].includes(value)) throw fail('INVALID_CHANNEL_TYPE'); plan.data[key] = value; }
            if (key === 'rateLimitPerUser') plan.data[key] = integer(value, 0, 21600);
            if (key === 'bitrate') plan.data[key] = integer(value, 8000, 384000);
            if (key === 'userLimit') plan.data[key] = integer(value, 0, 99);
            if (key === 'position') plan.data[key] = integer(value, 0, 499);
        }
        if (input.action === 'create_channel' && (!plan.data.name || plan.data.type === undefined)) throw fail('MISSING_FIELDS');
    } else if (['create_role', 'edit_role'].includes(input.action)) {
        keys(data, ['name', 'color', 'hoist', 'mentionable', 'permissions']);
        for (const [key, value] of Object.entries(data)) {
            if (key === 'name') plan.data[key] = text(value, 100);
            if (key === 'color') plan.data[key] = integer(value, 0, 0xffffff);
            if (['hoist', 'mentionable'].includes(key)) { if (typeof value !== 'boolean') throw fail('INVALID_BOOLEAN'); plan.data[key] = value; }
            if (key === 'permissions') plan.data[key] = bits(value);
        }
        if (input.action === 'create_role' && !plan.data.name) throw fail('MISSING_FIELDS');
    } else if (input.action === 'set_channel_permissions') {
        keys(data, ['roleId', 'allow', 'deny']);
        plan.data = { roleId: id(data.roleId), allow: bits(data.allow), deny: bits(data.deny) };
        if (BigInt(data.allow) & BigInt(data.deny)) throw fail('CONFLICTING_PERMISSIONS');
    } else {
        keys(data, input.action === 'edit_message' ? ['content', 'messageId'] : ['content']);
        plan.data.content = text(data.content, 2000);
        if (input.action === 'edit_message') plan.data.messageId = id(data.messageId);
    }
    if (!Object.keys(plan.data).length) throw fail('EMPTY_CHANGE');
    return plan;
}

function createControl({ client, env = process.env, now = Date.now, logger = console }) {
    const plans = new Map();
    let busy = false;
    function authorized(header) {
        const secret = env.SERVER_CONTROL_SECRET;
        if (env.SERVER_CONTROL_ENABLED !== 'true' || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret) || !ID.test(env.SERVER_CONTROL_GUILD_ID || '')) return false;
        if (typeof header !== 'string') return false;
        const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
        return a.length === b.length && timingSafeEqual(a, b);
    }
    async function guild() {
        if (!client.isReady()) throw fail('DISCORD_NOT_READY', 503);
        const result = client.guilds.cache.get(env.SERVER_CONTROL_GUILD_ID);
        if (!result) throw fail('SERVER_UNAVAILABLE', 404);
        await result.channels.fetch();
        await result.roles.fetch();
        return result;
    }
    function channel(g, targetId) {
        const result = g.channels.cache.get(targetId);
        if (!result || result.guildId !== g.id) throw fail('CHANNEL_UNAVAILABLE', 404);
        return result;
    }
    function role(g, targetId) {
        const result = g.roles.cache.get(targetId);
        if (!result || result.managed || result.id === g.id || !result.editable) throw fail('ROLE_NOT_EDITABLE', 403);
        return result;
    }
    function inspect(g, plan) {
        if (plan.data.parent !== undefined && plan.data.parent !== null && channel(g, plan.data.parent).type !== 4) throw fail('INVALID_PARENT');
        if (plan.action === 'edit_role') role(g, plan.targetId);
        else if (!plan.action.startsWith('create_')) channel(g, plan.targetId);
        if (plan.action === 'set_channel_permissions' && !g.roles.cache.has(plan.data.roleId)) throw fail('ROLE_UNAVAILABLE', 404);
        const permissions = plan.data.permissions ?? plan.data.allow;
        const me = g.members.me;
        if (permissions && (!me || !me.permissions.has(BigInt(permissions)))) throw fail('CANNOT_GRANT_PERMISSIONS', 403);
    }
    async function execute(g, plan) {
        const reason = 'Server owner requested management through Zohan control';
        let result;
        if (plan.action === 'create_channel') result = await g.channels.create({ ...plan.data, reason });
        else if (plan.action === 'edit_channel') result = await channel(g, plan.targetId).edit({ ...plan.data, reason });
        else if (plan.action === 'create_role') result = await g.roles.create({ ...plan.data, permissions: plan.data.permissions === undefined ? undefined : BigInt(plan.data.permissions), reason });
        else if (plan.action === 'edit_role') result = await role(g, plan.targetId).edit({ ...plan.data, ...(plan.data.permissions === undefined ? {} : { permissions: BigInt(plan.data.permissions) }), reason });
        else if (plan.action === 'set_channel_permissions') {
            const ch = channel(g, plan.targetId);
            // PUT one overwrite: preserve all other roles and member overwrites.
            await client.rest.put('/channels/' + ch.id + '/permissions/' + plan.data.roleId, {
                body: { type: 0, allow: plan.data.allow, deny: plan.data.deny }, reason
            });
            result = ch;
        } else if (plan.action === 'send_message') {
            const ch = channel(g, plan.targetId);
            if (![0, 5].includes(ch.type)) throw fail('TEXT_CHANNEL_REQUIRED');
            result = await ch.send({ content: plan.data.content, allowedMentions: { parse: [] } });
        } else if (plan.action === 'edit_message') {
            const ch = channel(g, plan.targetId);
            if (![0, 5].includes(ch.type)) throw fail('TEXT_CHANNEL_REQUIRED');
            const message = await ch.messages.fetch(plan.data.messageId);
            if (message.author.id !== client.user.id) throw fail('OWN_MESSAGES_ONLY', 403);
            result = await message.edit({ content: plan.data.content, allowedMentions: { parse: [] } });
        }
        logger.log('[server-control] applied action=' + plan.action + ' target=' + (result?.id || plan.targetId));
        return { id: result?.id || plan.targetId, action: plan.action };
    }
    async function run(input) {
        keys(input, ['op', 'plan', 'confirmation', 'channelId', 'limit', 'before']);
        if (!['snapshot', 'messages', 'prepare', 'apply'].includes(input.op)) throw fail('UNKNOWN_OPERATION');
        const g = await guild();
        if (input.op === 'snapshot') {
            return {
                guild: { id: g.id, name: g.name, ownerId: g.ownerId },
                bot: { id: client.user.id, permissions: g.members.me?.permissions.bitfield.toString() || null },
                channels: [...g.channels.cache.values()].filter(Boolean).map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.position,
                    topic: c.topic, bitrate: c.bitrate, userLimit: c.userLimit, rateLimitPerUser: c.rateLimitPerUser,
                    botPermissions: c.permissionsFor(client.user.id)?.bitfield.toString() || null,
                    overwrites: [...(c.permissionOverwrites?.cache.values() || [])].map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) })),
                roles: [...g.roles.cache.values()].map(r => ({ id: r.id, name: r.name, position: r.position, permissions: r.permissions.bitfield.toString(), managed: r.managed, editable: r.editable }))
            };
        }
        if (input.op === 'messages') {
            const ch = channel(g, id(input.channelId));
            if (![0, 5].includes(ch.type)) throw fail('TEXT_CHANNEL_REQUIRED');
            const limit = input.limit === undefined ? 20 : integer(input.limit, 1, 50);
            const messages = await ch.messages.fetch({ limit, ...(input.before ? { before: id(input.before) } : {}) });
            return [...messages.values()].map(m => ({ id: m.id, authorId: m.author.id, bot: m.author.bot, content: m.content, createdAt: new Date(m.createdTimestamp).toISOString(),
                embeds: m.embeds.map(e => ({ title: e.title, description: e.description, url: e.url, image: e.image?.url, fields: e.fields })) }));
        }
        for (const [token, entry] of plans) if (entry.expires <= now()) plans.delete(token);
        if (input.op === 'prepare') {
            if (plans.size >= 50) throw fail('TOO_MANY_PLANS', 429);
            const plan = validatePlan(input.plan);
            inspect(g, plan);
            const token = randomBytes(24).toString('hex');
            plans.set(token, { plan, expires: now() + 120000 });
            return { plan, confirmation: token, expiresInSeconds: 120, applied: false };
        }
        if (busy) throw fail('CHANGE_IN_PROGRESS', 409);
        const entry = plans.get(input.confirmation);
        if (!entry || entry.expires <= now()) throw fail('PLAN_EXPIRED', 409);
        plans.delete(input.confirmation); // Never repeat an ambiguous write after failure.
        busy = true;
        try { inspect(g, entry.plan); return await execute(g, entry.plan); }
        finally { busy = false; }
    }
    async function handle(req, res) {
        const reply = (status, value) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(JSON.stringify(value));
        };
        if (!authorized(req.headers.authorization)) { reply(401, { error: 'UNAUTHORIZED' }); req.resume(); return; }
        if (req.method !== 'POST') { reply(405, { error: 'POST_REQUIRED' }); req.resume(); return; }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { reply(415, { error: 'JSON_REQUIRED' }); req.resume(); return; }
        if (busy) { reply(409, { error: 'CHANGE_IN_PROGRESS' }); req.resume(); return; }
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 16384) { reply(413, { error: 'BODY_TOO_LARGE' }); return; }
                chunks.push(chunk);
            }
            let input;
            try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { throw fail('INVALID_JSON'); }
            reply(200, { result: await run(input) });
        } catch (error) {
            const code = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'DISCORD_REQUEST_FAILED';
            logger.error('[server-control] failed code=' + code);
            reply(error.status >= 400 && error.status <= 599 ? error.status : 502, { error: code });
        }
    }
    return { authorized, handle, run };
}

module.exports = { createControl, validatePlan };
