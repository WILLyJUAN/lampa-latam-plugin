/*
 * Development copy of the RePelisHD HTTP adapter bundled in ../latam.js.
 * It is kept separately to make the provider boundary and returned metadata
 * easy to review.  latam.js contains the same logic because Lampa loads a
 * plugin from one URL and does not resolve local CommonJS dependencies.
 */
(function (root) {
    'use strict';

    var USER_AGENT = 'Mozilla/5.0 (Linux; Tizen TV) AppleWebKit/537.36';

    function absoluteUrl(url) {
        if (/^https?:\/\//i.test(url || '')) return url;
        return /^\/\//.test(url || '') ? 'https:' + url : '';
    }

    function unpackPacker(html) {
        var match = String(html || '').match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
        if (!match) return '';

        var payload = match[1];
        var radix = parseInt(match[2], 10);
        var table = match[4].split('|');
        var alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var unbase = function (value) {
            var number = 0;
            for (var index = 0; index < value.length; index++) {
                var digit = alphabet.indexOf(value.charAt(index));
                if (digit < 0 || digit >= radix) return -1;
                number = number * radix + digit;
            }
            return number;
        };

        return payload.replace(/\b[0-9a-zA-Z]+\b/g, function (token) {
            var key = unbase(token);
            return key >= 0 && table[key] ? table[key] : token;
        });
    }

    function findHls(html) {
        var text = String(html || '').replace(/\\\//g, '/');
        var packed = unpackPacker(text);
        if (packed) text += '\n' + packed.replace(/\\\//g, '/');
        var match = text.match(/["'](https?:[^"'\\\s]+\.m3u8[^"'\\\s]*)["']/i) ||
            text.match(/(?:hls|file)\s*[:=]\s*["'](https?:[^"']+\.m3u8[^"']*)["']/i);
        return match ? match[1].replace(/\\\//g, '/') : '';
    }

    function create(httpText) {
        var sourceHome = 'https://repelishd.fit/';
        var proxyHome = 'https://verhdlink.cam/';

        return {
            id: 'latinuvio-repelishd',
            name: 'RePelisHD (latinuvio-V2)',
            source: 'latinuvio-V2/providers/repelishd.js',
            resolve: function (context) {
                var imdbId = context && context.imdb_id;
                if (!/^tt\d+$/i.test(imdbId || '')) return Promise.resolve([]);

                var suffix = context.type === 'tv' && context.season && context.episode ?
                    '?s=' + encodeURIComponent(context.season) + '&e=' + encodeURIComponent(context.episode) : '';
                var proxyUrl = proxyHome + 'movie/' + encodeURIComponent(imdbId) + suffix;

                return httpText(proxyUrl, { headers: { Referer: sourceHome } }).then(function (html) {
                    var result = [];
                    var lists = /<ul class="_player-mirrors\s+([^"]+)"[^>]*>([\s\S]*?)<\/ul>/gi;
                    var list;

                    while ((list = lists.exec(html)) !== null) {
                        var classes = list[1].toLowerCase();
                        var language = classes.indexOf('castellano') >= 0 || classes.indexOf('espanol') >= 0 ? 'Castellano' :
                            classes.indexOf('subtitulado') >= 0 || classes.indexOf('vose') >= 0 ? 'VOSE' : 'Latino';
                        var links = /data-link="([^"]+)"/gi;
                        var link;

                        while ((link = links.exec(list[2])) !== null) {
                            var embedUrl = absoluteUrl(link[1]);
                            if (!embedUrl) continue;
                            result.push({
                                provider: 'RePelisHD',
                                title: language + ' · Embed',
                                language: language,
                                audioTracks: [{ id: language.toLowerCase(), name: language, language: language }],
                                quality: /dropload|supervideo/i.test(embedUrl) ? '1080p' : '720p',
                                url: embedUrl,
                                embedUrl: embedUrl,
                                isEmbed: true,
                                sourceUrl: proxyUrl,
                                headers: { Referer: proxyUrl, 'User-Agent': USER_AGENT }
                            });
                        }
                    }

                    return Promise.all(result.map(function (stream) {
                        return httpText(stream.url, { headers: { Referer: proxyUrl } }).then(function (embedHtml) {
                            var directUrl = findHls(embedHtml);
                            if (directUrl) {
                                stream.url = directUrl;
                                stream.title = stream.language + ' · Direct';
                                stream.isEmbed = false;
                                stream.headers = { Referer: stream.embedUrl, 'User-Agent': USER_AGENT };
                            }
                            return stream;
                        }, function () { return stream; });
                    }));
                });
            }
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { create: create };
    else root.LampaLatamRePelisHd = { create: create };
}(typeof window !== 'undefined' ? window : globalThis));
