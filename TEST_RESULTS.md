# Результаты проверки

Дата проверки: 2026-08-28 (America/Argentina/Buenos_Aires).

## Снимки исходников

| Репозиторий | Commit |
| --- | --- |
| `latinokodi/latinuvio-V2` | `fe60a56f5ce444148ec2c8f40b6834c5e920a672` |
| `yoruix/nuvio-providers` | `cb4bf144217d597dc9ac0c50a8c476366a6749c8` |
| `roberthgnz/cinecalidad-stremio-addon` | `bdabc1c807ef3f60408c46576a14a4631c9f0dea` |

## Статический аудит

| Проверка | Итог |
| --- | --- |
| Записей в `latinuvio-V2/manifest.json` | 35 |
| Провайдеров, возвращающих `headers` | 35 из 35 |
| Провайдеров с `axios`, `cheerio` или `crypto-js` | 23 из 35 |
| Провайдеров с magnet/torrent путём | 2 из 35 |
| Провайдеров с iframe/embed fallback | 8 из 35 |
| `nuvio-providers` | Только отключённый `template-provider` в manifest |
| `cinecalidad-stremio-addon` | Node/Express/SQLite backend; обработчик включает magnet/torrent |

## Динамические HTTP-проверки исходной логики

Тестовые идентификаторы: TMDB `872585` (*Oppenheimer*, movie) и TMDB `1396` (*Breaking Bad*, S01E01). Тесты не скачивали видеоконтент: только страницы провайдеров и HTTP `HEAD` итогового manifest.

| Провайдер | Результат исходной функции | Формат | Tizen/AVPlay |
| --- | --- | --- | --- |
| `Cine24H` | 0 результатов | — | исключён: источник на момент проверки не вернул поток |
| `VerOnline` | 0 результатов | — | исключён: источник на момент проверки не вернул эпизод |
| `PelisGratisHD` | найден фильм, но 0 player options | — | исключён: HTML не соответствует текущему парсеру upstream |
| `HomeCine` | 3 результата: Latino, Castellano, VOSE | HLS `.m3u8` | исключён: каждый URL вернул HTTP 403 без доступного AVPlay механизма заголовков |
| `RePelisHD` | 8 результатов, в том числе direct Latino/Castellano | HLS `.m3u8` | исключён из запуска: без заголовков — HTTP 403; с исходными `Referer` + `User-Agent` — HTTP 200 и `application/vnd.apple.mpegurl` |

### Подтверждение ограничения Tizen

В локальном исходнике Lampa `Lampa-source/src/interaction/player/video/tizen.js` поток открывается вызовом `webapis.avplay.open(url)`. Плеер не читает `headers` из объекта `Lampa.Player.play`. Поэтому плагины не могут корректно передать значения, которые исходные провайдеры требуют для `RePelisHD` и `HomeCine`.

## Проверки артефакта

| Проверка | Ожидаемый результат |
| --- | --- |
| `node --check lampa-latam-plugin/latam.js` и `providers/repelishd.js` | пройдено |
| Загрузка с mock `window.Lampa` | пройдено: плагин экспортирует `window.LampaLatam`, регистрирует RePelisHD и нормализует все требуемые поля |
| `window.LampaLatam.tizenStatus()` | пройдено: блокирует URL с `Referer`/`User-Agent`, iframe и не‑HLS/MP4; разрешает только прямой HTTPS HLS/MP4 без заголовков |
| `providers/repelishd.js` с реальным HTTP transport | пройдено: 8 результатов, 2 direct HLS; `HEAD` первого HLS с возвращёнными заголовками: `200 application/vnd.apple.mpegurl` |
| Полная цепочка `latam.js` с Lampa-compatible mock `Reguest` | пройдено: 8 нормализованных результатов, 2 direct HLS, все 8 корректно заблокированы Tizen guard до `Lampa.Player.play` |

Аппаратная проверка на телевизоре не выполнялась: в рабочей среде нет подключённого Samsung TV. До такого теста не следует считать ни один header‑dependent источник совместимым с Tizen.
