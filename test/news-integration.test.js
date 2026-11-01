const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8').replaceAll('\r\n', '\n');
function extract(from, to, context, expression) {
    return vm.runInNewContext(source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))) + '\n' + expression, context);
}
const quiet = { log() {}, error() {} };

test('actual RSS function tolerates one failed source and sorts successful articles', async () => {
    const fetchNews = extract('async function fetchGameNews()', '// Функция получения LOL новостей', {
        RSS_FEEDS: [{ name: 'broken', url: 'broken' }, { name: 'ok', url: 'ok' }], console: quiet,
        gameRssParser: { async parseURL(url) {
            if (url === 'broken') throw new Error('network');
            return { items: [{ title: 'older', pubDate: '2026-10-16' }, { title: 'newer', isoDate: '2026-10-17' }] };
        } }
    }, 'fetchGameNews');
    const news = await fetchNews(); assert.equal(news.length, 2); assert.equal(news[0].title, 'newer');
});

test('actual RSS function rejects when every feed is broken or malformed', async () => {
    const fetchNews = extract('async function fetchGameNews()', '// Функция получения LOL новостей', {
        RSS_FEEDS: [{ name: 'bad', url: 'bad' }], console: quiet,
        gameRssParser: { async parseURL() { return { items: null }; } }
    }, 'fetchGameNews');
    await assert.rejects(fetchNews(), { code: 'NEWS_RSS_ALL_FAILED' });
});

function translator(fetch) {
    return extract('function sanitizeText(text)', '// ==================== КОМАНДЫ', {
        process: { env: { DEEPL_API_KEY: 'test-key' } }, fetch, proxyAgent: null, AbortSignal, console: quiet
    }, 'translateToRussian');
}

test('actual translator sends DeepL key only in auth header and text in JSON body', async () => {
    let request;
    const translate = translator(async (url, options) => {
        request = { url, options }; return { ok: true, async json() { return { translations: [{ text: 'Перевод' }] }; } };
    });
    assert.equal(await translate('<b>Gaming news</b> &amp; updates'), 'Перевод');
    assert.equal(request.url, 'https://api-free.deepl.com/v2/translate');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'DeepL-Auth-Key test-key');
    assert.deepEqual(JSON.parse(request.options.body).text, ['Gaming news & updates']);
    assert.ok(!request.url.includes('test-key'));
});

test('actual translator falls back to Google, then clean original text on total failure', async () => {
    let calls = 0;
    const translate = translator(async () => {
        if (++calls === 1) return { ok: false, status: 503 };
        return { ok: true, async json() { return [[['Перевод Google', 'Original']]]; } };
    });
    assert.equal(await translate('Gaming news'), 'Перевод Google'); assert.equal(calls, 2);
    const unavailable = translator(async () => { throw new Error('unavailable'); });
    assert.equal(await unavailable('<b>Gaming news</b>'), 'Gaming news');
});
