/*
 * Lampa LATAM compatibility adapter for Samsung Tizen.
 *
 * This file is intentionally self-contained so it can be installed from a
 * single HTTPS URL in Lampa.  The implementation only permits AVPlay-safe
 * streams: direct HTTPS MP4/HLS URLs that do not require playback headers.
 *
 * Upstream review: 2026-08-28.  See README.md and TEST_RESULTS.md.
 */
(function (root) {
    'use strict';

    var VERSION = '0.1.0';
    var USER_AGENT = 'Mozilla/5.0 (Linux; Tizen TV) AppleWebKit/537.36';
    var providerRegistry = [];

    function unique(values) {
        var output = [];
        (values || []).forEach(function (value) {
            if (value && output.indexOf(value) === -1) output.push(value);
        });
        return output;
    }

    function titleForMovie(movie) {
        return movie && (movie.title || movie.name || movie.original_title || movie.original_name) || 'LATAM';
    }

    function languageFromLabel(label) {
        var value = String(label || '').toLowerCase();
        if (value.indexOf('cast') >= 0 || value.indexOf('esp') >= 0) return 'Castellano';
        if (value.indexOf('vose') >= 0 || value.indexOf('sub') >= 0) return 'VOSE';
        if (value.indexOf('eng') >= 0 || value.indexOf('ingl') >= 0) return 'Inglés';
        return 'Latino';
    }

    function isDirectMedia(url) {
        return /^https:\/\//i.test(url || '') && /(?:\.m3u8|\.mp4)(?:[?#]|$)/i.test(url || '');
    }

    function hasPlaybackHeaders(headers) {
        var names = Object.keys(headers || {});
        return names.some(function (name) {
            return String(headers[name] || '').trim() !== '';
        });
    }

    /*
     * Samsung's AVPlay binding in Lampa invokes webapis.avplay.open(url) and
     * has no API for Referer, User-Agent, Cookie or arbitrary HTTP headers.
     */
    function tizenStatus(stream) {
        if (!stream || !stream.url) return { playable: false, reason: 'Нет URL потока' };
        if (!/^https:\/\//i.test(stream.url)) return { playable: false, reason: 'Tizen принимает только HTTPS URL' };
        if (!isDirectMedia(stream.url)) return { playable: false, reason: 'URL не является прямым HLS/MP4 потоком' };
        if (hasPlaybackHeaders(stream.headers)) return { playable: false, reason: 'AVPlay не поддерживает необходимые HTTP-заголовки потока' };
        if (stream.isEmbed) return { playable: false, reason: 'Требуется iframe/embed-resolver' };
        return { playable: true, reason: '' };
    }

    function normalizeStream(raw) {
        raw = raw || {};
        var language = raw.language || raw.audioLanguage || languageFromLabel(raw.title || raw.audio || raw.lang);
        var tracks = raw.audioTracks || raw.availableAudioTracks || [];

        if (!tracks.length) {
            tracks = [{
                id: language.toLowerCase(),
                name: language,
                language: language
            }];
        }

        return {
            id: raw.id || [raw.provider || raw.name || 'LATAM', raw.url || ''].join(':'),
            provider: raw.provider || raw.name || 'LATAM',
            name: raw.name || raw.provider || 'LATAM',
            title: raw.title || raw.name || 'Поток',
            language: language,
            audioTracks: tracks.map(function (track) {
                return {
                    id: track.id || track.language || track.name,
                    name: track.name || track.language || language,
                    language: track.language || track.name || language
                };
            }),
            quality: raw.quality || 'HD',
            url: raw.url || '',
            headers: raw.headers || {},
            isEmbed: Boolean(raw.isEmbed),
            sourceUrl: raw.sourceUrl || '',
            tizen: tizenStatus(raw)
        };
    }

    function httpText(url, options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            if (!root.Lampa || !root.Lampa.Reguest) {
                reject(new Error('Lampa.Reguest недоступен'));
                return;
            }

            var request = new root.Lampa.Reguest();
            request.timeout(options.timeout || 15000);
            request.silent(url, function (text) {
                resolve(String(text || ''));
            }, function (xhr, error) {
                reject(new Error(request.errorDecode(xhr, error)));
            }, null, {
                dataType: 'text',
                headers: options.headers || {}
            });
        });
    }

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

    /*
     * A compact, dependency-free reimplementation of the HTTP path used by
     * latinuvio-V2/providers/repelishd.js.  It intentionally keeps the
     * upstream provider's language, quality, source URL and headers intact.
     */
    function createRePelisHdAdapter() {
        var sourceHome = 'https://repelishd.fit/';
        var proxyHome = 'https://verhdlink.cam/';

        return {
            id: 'latinuvio-repelishd',
            name: 'RePelisHD (latinuvio-V2)',
            source: 'latinuvio-V2/providers/repelishd.js',
            enabled: true,
            resolve: function (context) {
                var imdbId = context && context.imdb_id;
                if (!/^tt\d+$/i.test(imdbId || '')) {
                    return Promise.resolve([]);
                }

                var suffix = context.type === 'tv' && context.season && context.episode ?
                    '?s=' + encodeURIComponent(context.season) + '&e=' + encodeURIComponent(context.episode) : '';
                var proxyUrl = proxyHome + 'movie/' + encodeURIComponent(imdbId) + suffix;

                return httpText(proxyUrl, { headers: { Referer: sourceHome } }).then(function (html) {
                    var streams = [];
                    var listExpression = /<ul class="_player-mirrors\s+([^"]+)"[^>]*>([\s\S]*?)<\/ul>/gi;
                    var list;

                    while ((list = listExpression.exec(html)) !== null) {
                        var classes = list[1].toLowerCase();
                        var language = classes.indexOf('castellano') >= 0 || classes.indexOf('espanol') >= 0 ? 'Castellano' :
                            classes.indexOf('subtitulado') >= 0 || classes.indexOf('vose') >= 0 ? 'VOSE' : 'Latino';
                        var linkExpression = /data-link="([^"]+)"/gi;
                        var link;

                        while ((link = linkExpression.exec(list[2])) !== null) {
                            var embedUrl = absoluteUrl(link[1]);
                            if (!embedUrl) continue;
                            streams.push({
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

                    return Promise.all(streams.map(function (stream) {
                        return httpText(stream.url, { headers: { Referer: proxyUrl } }).then(function (embedHtml) {
                            var directUrl = findHls(embedHtml);
                            if (directUrl) {
                                stream.url = directUrl;
                                stream.title = stream.language + ' · Direct';
                                stream.isEmbed = false;
                                stream.headers = { Referer: stream.embedUrl, 'User-Agent': USER_AGENT };
                            }
                            return stream;
                        }, function () {
                            return stream;
                        });
                    }));
                });
            }
        };
    }

    function registerProvider(provider) {
        if (provider && provider.id && !providerRegistry.some(function (item) { return item.id === provider.id; })) {
            providerRegistry.push(provider);
        }
    }

    function resolve(context) {
        var jobs = providerRegistry.filter(function (provider) { return provider.enabled; }).map(function (provider) {
            return provider.resolve(context).then(function (streams) {
                return (streams || []).map(normalizeStream);
            }, function (error) {
                return [{
                    id: provider.id + ':error',
                    provider: provider.name,
                    title: 'Ошибка провайдера: ' + error.message,
                    language: '',
                    audioTracks: [],
                    quality: '',
                    url: '',
                    headers: {},
                    error: error.message,
                    tizen: { playable: false, reason: 'HTTP-запрос не завершился: ' + error.message }
                }];
            });
        });

        return Promise.all(jobs).then(function (groups) {
            return [].concat.apply([], groups);
        });
    }

    function chooseSource(streams, movie) {
        var playable = streams.filter(function (stream) { return stream.tizen && stream.tizen.playable; });
        var rejected = streams.filter(function (stream) { return !stream.tizen || !stream.tizen.playable; });

        if (!playable.length) {
            var reasons = unique(rejected.map(function (stream) {
                return stream.provider + ': ' + (stream.tizen ? stream.tizen.reason : 'неизвестная причина');
            }));
            if (root.Lampa && root.Lampa.Select) {
                root.Lampa.Select.show({
                    title: 'LATAM: нет совместимых потоков',
                    items: reasons.map(function (reason) { return { title: reason }; })
                });
            } else if (root.Lampa && root.Lampa.Noty) {
                root.Lampa.Noty.show('LATAM: нет совместимых с Tizen потоков');
            }
            return;
        }

        var languages = unique(playable.map(function (stream) { return stream.language; }));
        var selectSourceForLanguage = function (language) {
            var choices = playable.filter(function (stream) { return stream.language === language; });
            root.Lampa.Select.show({
                title: 'LATAM: источник (' + language + ')',
                items: choices.map(function (stream) {
                    return {
                        title: stream.provider + ' · ' + stream.quality,
                        subtitle: stream.title,
                        stream: stream
                    };
                }),
                onSelect: function (choice) {
                    play(choice.stream, movie);
                }
            });
        };

        if (languages.length === 1) {
            selectSourceForLanguage(languages[0]);
            return;
        }

        root.Lampa.Select.show({
            title: 'LATAM: аудиодорожка',
            items: languages.map(function (language) { return { title: language, language: language }; }),
            onSelect: function (choice) { selectSourceForLanguage(choice.language); }
        });
    }

    function play(stream, movie) {
        if (!stream.tizen || !stream.tizen.playable) {
            root.Lampa.Noty.show(stream.tizen ? stream.tizen.reason : 'Поток не поддерживается');
            return;
        }
        root.Lampa.Player.play({
            url: stream.url,
            title: titleForMovie(movie) + ' / ' + stream.provider + ' / ' + stream.language,
            quality: stream.quality,
            card: movie
        });
    }

    function installButton() {
        if (!root.Lampa || !root.Lampa.Listener || !root.$) return;

        root.Lampa.Listener.follow('full', function (event) {
            if (event.type !== 'complite' || !event.data || !event.data.movie) return;
            var view = event.object && event.object.activity && event.object.activity.render ? event.object.activity.render() : null;
            if (!view || view.find('.view--latam').length) return;

            var button = root.$('<div class="full-start__button selector view--latam" data-subtitle="Tizen"><span>LATAM</span></div>');
            button.on('hover:enter', function () {
                var movie = event.data.movie;
                root.Lampa.Noty.show('LATAM: проверка совместимости источников…');
                resolve({
                    imdb_id: movie.imdb_id,
                    type: movie.name ? 'tv' : 'movie',
                    season: movie.season,
                    episode: movie.episode,
                    movie: movie
                }).then(function (streams) {
                    chooseSource(streams, movie);
                });
            });

            var torrentButton = view.find('.view--torrent');
            if (torrentButton.length) torrentButton.after(button);
            else view.find('.full-start__buttons').append(button);
        });
    }

    registerProvider(createRePelisHdAdapter());

    root.LampaLatam = {
        version: VERSION,
        providers: providerRegistry,
        normalizeStream: normalizeStream,
        tizenStatus: tizenStatus,
        resolve: resolve,
        chooseSource: chooseSource
    };

    installButton();
}(typeof window !== 'undefined' ? window : globalThis));
