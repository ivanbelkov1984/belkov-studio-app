# Управление логикой мини-приложения/бота из админки владельца (Telegram + MAX, малый стек)

Дата исследования: 2026-11-06. Стек: статический vanilla JS (nginx) + aiohttp/asyncpg/PostgreSQL на РФ-сервере. «Cited» — факты со ссылкой на реально открытые источники; «Inferences» — мои выводы/проектные решения; «Gaps» — не подтверждено.

---

## 1. Каталог «пультов управления» (remote config / CMS) и минимум для маленькой студии

### Takeaway
Firebase Remote Config, Unleash, GrowthBook сводятся к одной модели: именованный параметр/флаг + значение по умолчанию + условия/сегменты + процент раскатки + версия с откатом. Студии достаточно версионируемых JSON-блоков, таблицы флагов, промокодов и расписания «с–по»; headless CMS и Notion-как-CMS не нужны.

### Cited Findings
- Firebase Remote Config хранит до 300 версий шаблона на тип; откат создаёт НОВУЮ версию с прежним содержимым (с 10 к 6 даёт версию 11) — [Firebase: templates](https://firebase.google.com/docs/remote-config/templates)
- Unleash: флаг включён, если истинна хотя бы одна стратегия (OR); constraints внутри стратегии объединяются по AND; операторы IN/NOT_IN, числовые, DATE_AFTER/BEFORE, строковые, SEMVER; сегменты — переиспользуемые наборы условий — [Unleash: activation strategies](https://docs.getunleash.io/reference/activation-strategies)
- Unleash: процент раскатки через нормализованный MurmurHash user ID; stickiness сохраняет вариант пользователя между сессиями — [Unleash](https://docs.getunleash.io/reference/activation-strategies)
- GrowthBook: Байесовский движок по умолчанию («Chance to Win», ориентир ≈95%), частотный с CUPED и sequential-тестами; настраиваемые пороги минимума данных на метрику — [GrowthBook stats](https://docs.growthbook.io/statistics/overview)
- Telegram: `startapp` передаётся как `start_param`/`tgWebAppStartParam` — основа текстов под источник — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- MAX: `initDataUnsafe.start_param`; payload startapp ≤512 символов (латиница, цифры, `_`, `-`) — [MAX WebApp intro](https://dev.max.ru/docs/webapps/introduction); для deep link в бота (`bot_started.payload`) ≤128 — [MAX: подготовка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare)

### Inferences
Каталог capabilities (admin → app):

| # | Capability | Хранение | Приоритет |
|---|---|---|---|
| 1 | Услуги, пакеты, цены, состав | `content_blocks` key=`services` | P0 |
| 2 | Коэффициенты калькулятора | `content_blocks` key=`calc` | P0 |
| 3 | FAQ, кейсы, баннеры, тексты экранов, CTA | `content_blocks` | P0 |
| 4 | Maintenance, «приём заявок закрыт» | флаг + текст | P0 |
| 5 | Рабочие часы, доступность, SLA-фраза | `settings` (TZ Europe/Moscow) | P0 |
| 6 | Тексты под `start_param` | блоки + варианты по source | P1 |
| 7 | Сезонные акции, ограниченные предложения | `promos` + баннер с датами | P1 |
| 8 | Промокоды/скидки | `promos` + `promo_redemptions` | P1 |
| 9 | Фичефлаги | `flags` (on/off, percent, platform/source) | P1 |
| 10 | A/B заголовка/CTA | `experiments` + `exposure` | P2 |
| 11 | Автоответы, шаблоны, дожим | `message_templates`, `followup_rules` | P1–P2 |
| 12 | Рассылки с сегментами и согласием | `broadcasts`, `broadcast_jobs`, `consents` | P2 |

- Минимум: пп. 1–5 (P0) + промо/флаги/тексты по source (P1). Условий флага достаточно трёх: `platform`, `source`, `percent` (стабильный хэш) — по образцу Unleash, без SDK.
- Directus/Strapi/Payload/Sanity дают готовую админку, но добавляют сервис и второй контур авторизации; одна HTML-страница админки на 5–15 JSON-блоков дешевле. Notion-как-CMS противоречит правилу «данные на РФ-сервере».
- In-app defaults Firebase переносятся как «вшитый defaults.json».

### Gaps
- Документация Directus/Strapi/Payload/Sanity/LaunchDarkly не открывалась; сравнение без цитат.
- Страница Firebase Remote Config overview вернула 404; лимиты числа параметров и размера значения не подтверждены.

---

## 2. Бот: рассылки, планирование, дожим, комментарии, триггеры

### Takeaway
Технически рассылка упирается в скорость (TG ≈30/с, MAX ≤30 rps), юридически — в предварительное согласие на рекламу (ст. 18 38-ФЗ) и отдельное согласие на ПДн (152-ФЗ). В MAX есть события `comment_created/edited/removed` для реакции на комментарии канала.

### Cited Findings
- Telegram: ~1 сообщение/с на чат; 20 сообщений/мин в группе; массовые уведомления ~30 пользователей/с, превышение — 429; длинные рассылки советуют растягивать (в FAQ упомянуты 8–12 часов) — [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- Платные рассылки Telegram: до 1000 сообщений/с, 0,1 Stars сверх бесплатных 30/с; нужны ≥100 000 Stars и ≥100 000 MAU — [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- MAX API: `https://platform-api2.max.ru/`, токен бота в `Authorization`, до 30 rps; Webhook и Long Polling одновременно нельзя, в production только Webhook (`POST /subscriptions`); для payload из deep link нужен `bot_started` — [MAX: подготовка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare)
- MAX: только HTTPS; с 25 мая запрещены HTTP и самоподписанные сертификаты, допустимы доверенные УЦ включая Минцифры; боты работают после модерации; в личные диалоги бота не добавляют; нужны права `read_all_messages` и `write`; не класть секреты в payload; подключение только для резидентов РФ — [MAX: подготовка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare)
- MAX update_type: `bot_added`, `bot_started`, `bot_stopped`, `bot_removed`, `dialog_cleared/muted/unmuted/removed`, `message_callback`, `message_created/edited/removed`, `comment_created`, `comment_edited`, `comment_removed`, `user_added/removed`, `chat_title_changed`, `bot_admin_permissions_changed` (только Webhook); бот не получает события о своих комментариях — [MAX: Update](https://dev.max.ru/docs-api/objects/Update)
- MAX комментарии: нужно включить комментарии в канале; подписка `comment_created/removed/edited`; ID поста — `message.recipient.post_id`, текст — `body.text`; ответ `POST /messages/{messageId}/comments`; права админа `read_all_messages`, `edit`, `write`, `delete`; пути удаления в документации противоречивы — [MAX: модерация комментариев](https://dev.max.ru/docs-api/use-cases/comment-moderation)
- MAX клавиатура: ≤210 кнопок, ≤30 рядов, ≤7 в ряду (link/open_app/request_geo_location/request_contact — ≤3), URL ≤2048 — [MAX: клавиатура](https://dev.max.ru/docs-api/use-cases/sending-messages/keyboard)
- Право (по блогам, закон не открывался): реклама без предварительного согласия запрещена (ч. 1 ст. 18 38-ФЗ); согласие на ПДн оформляется отдельно; сообщается о запрете первичного сбора ПДн через иностранные сервисы с 01.07.2025 и о праве абонента заранее отказаться от рекламы с 01.08.2025, перекрывающем ранее данное согласие — [workspace.ru](https://workspace.ru/blog/kak-biznesu-legalno-ispolzovat-chat-boty-v-telegram-v-2026-godu-izbegaem-shtrafov/), [bothelp.io](https://bothelp.io/ru/soglasie-na-poluchenie-rassylok) (найдены поиском, не вычитаны)
- MAX рассылки: допустимы тем, кто сам запустил бота и дал согласие; при жалобах блокировка — [Elama](https://elama.ru/blog/massovaya-rassylka-max/), [Timeweb](https://timeweb.com/ru/community/articles/rassylki-v-max-rabochie-scenarii-v-2026-godu)

### Inferences
- Очередь `broadcast_jobs` (broadcast_id, user_id, channel, status pending/sent/failed/blocked, attempts, next_try_at), уникальность (broadcast_id, user_id), один asyncio-воркер с token-bucket ≈10–15 msg/с. На 429 — пауза по `retry_after` (поле Telegram — из общих знаний); «blocked» → `users.reachable=false`.
- `consents(user_id, kind pd|ads, text_version, given_at, revoked_at, source)`; рассылка берёт только активное `ads` и `reachable`; `/stop` и кнопка отписки в каждом рекламном сообщении. Чекбокс не предустановлен. Формулировки согласия — на проверку юристу.
- Сегменты — именованные SQL-фильтры (tag, source, last_seen_days, stage, platform), не конструктор. Триггеры по тегам — `followup_rules(trigger, delay, template_id, stop_conditions)`.
- Дожим: планировщик раз в минуту выбирает лидов (`brief_open` без ответа дольше delay). Консервативно: только в рамках диалога, начатого пользователем; сервисное vs рекламное — граница оценочная.
- `comment_created` → ключевые слова → автоответ через `POST /messages/{id}/comments` или уведомление владельцу + событие `comment`.
- Запланированные посты — `scheduled_posts` + тот же воркер, обязательный предпросмотр «себе».

### Gaps
- Тексты 38-ФЗ, 152-ФЗ, 41-ФЗ не открыты; тезис «чат-боты вне ст. 18.1» из Habr 2017 не подтверждён для 2026.
- Суточные лимиты рассылки MAX и возможность писать не запускавшему бота не найдены; «осторожнее ~1/с на чат» — из неофициального Rust-клиента maxbot (docs.rs), не подтверждено.
- Поведение 429/`retry_after` в MAX не найдено.

---

## 3. Безопасность и согласованность

### Takeaway
Контент — неизменяемые версии с указателем `published_version`; публикация = смена указателя после валидации схемой; клиент берёт `/api/config` с ETag и при сбое использует вшитые defaults. Владелец определяется подписанным initData (HMAC) и списком `OWNER_IDS`; админ-текст выводится через `textContent`.

### Cited Findings
- Откат как новая версия-копия — [Firebase](https://firebase.google.com/docs/remote-config/templates)
- Telegram initData: убрать `hash`, отсортировать поля, `key=value` через `\n`, `secret_key = HMAC_SHA256("WebAppData", bot_token)`, `hash = HMAC_SHA256(secret_key, data_check_string)` hex; проверять `auth_date`; есть проверка без токена по Ed25519 `signature` — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- MAX initData: из фрагмента URL (`WebAppData`) или `window.WebApp.initData`; тот же HMAC-алгоритм; окно валидности `auth_date` документация не задаёт — добавлять самим — [MAX: валидация](https://dev.max.ru/docs/webapps/validation); `initDataUnsafe` для проверки не использовать — [MAX Bridge](https://dev.max.ru/docs/webapps/bridge)
- XSS: `textContent` вместо `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`; DOMPurify, если нужен HTML; Trusted Types (поддержка неполная); strict CSP с nonce/hash — [MDN: XSS](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS)

### Inferences
- `content_versions(id,key,version,body jsonb,status,author_id,created_at,comment)` + `content_pointers(key,published_version)`; publish/rollback в транзакции + `audit_log`; хранить ~50 версий на ключ.
- Preview: `?preview=<короткоживущий токен владельца>`, `/api/config?preview=` отдаёт draft только владельцу.
- Валидация на сервере: свой компактный валидатор типов/диапазонов или `jsonschema`; цена ≥0, множители в границах, whitelist схем URL (`https:`, `tg:`, `max:`), длины строк.
- Рендер: только `textContent`/`createElement`; микроформат `**bold**`, `[текст](https://…)` вручную с проверкой URL. CSP на nginx: `default-src 'self'; script-src 'self' <SDK TG/MAX>; connect-src 'self'; object-src 'none'; base-uri 'none'`.
- Кэш: `ETag` + `Cache-Control: max-age=60, stale-while-revalidate=600`; клиент: кэш → сеть (таймаут 2–3 с) → кэш → вшитый `defaults.json`.
- Аудит: `audit_log(actor_id, action, entity, before, after, ip, ts)` в той же транзакции; без UPDATE/DELETE из приложения.
- Права: `OWNER_IDS` в окружении (не в БД); `Authorization: tma <initData>` / аналог для MAX; `auth_date` ≤1 ч для админ-действий; rate-limit token-bucket на user_id/IP; `client_max_size`.
- Публичный `/api/config` без секретов; промокоды проверяются на сервере (`POST /api/promo/check`).

### Gaps
- CSP внутри WebView Telegram/MAX не проверялся.
- Окно `auth_date` (1–24 ч) выбрано мной.

---

## 4. Аналитика

### Takeaway
Хватает одной таблицы событий и 3–4 SQL-запросов. A/B на десятках посетителей значимости не даст: тестировать только крупные эффекты верхней воронки либо сравнивать «до/после» с оговорками.

### Cited Findings
- Планировать по конверсиям на вариант: ~400 конверсий на вариант для подъёма 20%; при 100–500 конверсий реалистичен эффект ≳30%; оценки в блогах от 100–300 визитов (Байес) до ~1000 конверсий, нижние оптимистичны; порог 95%; ранние результаты нестабильны; если нужная выборка >~8 недель трафика — тестировать более крупное изменение или не тестировать — [Mida](https://mida.so/blog/how-much-traffic-ab-testing), [Convert](https://convert.com/blog/a-b-testing/i-dont-have-enough-traffic-to-a-b-test-now-what/), [AdWave](https://adwave.com/resources/a-b-testing-low-traffic) (сводка поиска, вендорные блоги)
- GrowthBook: порог ≈95%, минимальные пороги данных — [GrowthBook](https://docs.growthbook.io/statistics/overview)
- Telegram: `start_param`, `chat_type`, `chat_instance` при запуске прямой ссылки — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- MAX: `start_param`, `platform` (ios/android/desktop/web), `version`; `getLaunchContext().entryPoint` (Android 26.19.2+/iOS 26.20.0+) — [MAX Bridge](https://dev.max.ru/docs/webapps/bridge)

### Inferences
- `events(id, ts, anon_id, user_id, platform, source, session_id, name, props jsonb)`, индексы `(name,ts)`, `(user_id,ts)`. События: `app_open, view_service, calc_step, calc_done, brief_open, lead_sent, pay_open, paid, promo_apply, exposure, banner_click, comment`, серверные `bot_started/bot_stopped`.
- Атрибуция: first-touch в `users.first_source`, last-touch в событиях; формат `startapp=src_<код>` ≤40 символов, справочник `sources` в админке.
- Приватность: `anon_id` UUID; без имени/телефона/текста брифа; телефон только в `leads` по явному действию; события старше 12–18 мес. агрегировать; без внешних трекеров.
- Воронка: `count(DISTINCT coalesce(user_id::text, anon_id))` по `name` за 30 дней; порядковая — `min(ts) FILTER (WHERE name=…)` по пользователю; разрезы source/platform; когорты по неделе первого `app_open`.
- Дашборд малого объёма: уники/неделя по source; воронка; список заявок с источником; шаг калькулятора с наибольшим отвалом; использование промо. Абсолютные числа («7 из 23») и интервалы Уилсона.
- A/B: при ~5% конверсии и 50 визитах на вариант 2–3 заявки — не интерпретируемо. Практика: правка + «до/после»; A/B только для кликов по CTA и крупных различий; правило решения заранее (≥100 экспозиций на вариант и ≥95%, иначе «ничья — оставить текущий»). Вариант: `hash(experiment_key + anon_id) % 100`, `exposure` раз за сессию. Эксперименты — в P2.

### Gaps
- Источники по малым выборкам — вендорные блоги; расчёт мощности не делался.
- Конверсионные ориентиры для SMM-услуг в мессенджерах не найдены.
- Umami/PostHog/Plausible как альтернатива не исследовались.

---

## 5. Особенности платформ Telegram и MAX

### Takeaway
SDK похожи (BackButton, openLink, requestContact, haptics, хранилища, share), нужен тонкий адаптер `platform.js`. Для РФ-сервера критичны доступность `api.telegram.org` и сертификаты вебхука MAX.

### Cited Findings
- Telegram: CloudStorage (6.9+) ≤1024 ключей, ключ 1–128 символов `[A-Za-z0-9_-]`, значение ≤4096; DeviceStorage (9.0+) ≤5 МБ; SecureStorage (9.0+) ≤10 элементов — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- Telegram: MainButton→BottomButton (7.10) + SecondaryButton; BackButton (6.1); `openLink` по действию пользователя; `requestContact` (6.9); HapticFeedback (6.1) — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- MAX Bridge: BackButton; DeviceStorage и SecureStorage (≤10 ключей) — не поддерживаются в вебе; `requestContact()` → `phone`, `authDate`, `hash` (использовать только внутри текущего мини-апа); `openLink` (клик) / `openMaxLink`; `shareContent`, `shareMaxContent({text,link}|{mid,chatType})` (для медиа бот сначала шлёт сообщение через `POST /messages`); HapticFeedback недоступен на desktop/web; `enableClosingConfirmation`, `downloadFile`, `openCodeReader` — [MAX Bridge](https://dev.max.ru/docs/webapps/bridge), [MAX intro](https://dev.max.ru/docs/webapps/introduction)
- MAX: `platform-api2.max.ru`; вебхуки по HTTPS с доверенным УЦ (включая Минцифры); `POST /uploads` затем вложение в сообщение (детали токенов на открытой странице не описаны) — [MAX: подготовка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare)
- Ссылки Telegram: `t.me/<bot>?startapp=<param>`, `t.me/<bot>/<app>?startapp=<param>` — [Telegram Mini Apps](https://core.telegram.org/bots/webapps)

### Inferences
- Адаптер: `P = window.Telegram?.WebApp ? tgAdapter : window.WebApp ? maxAdapter : webStub` с интерфейсом `{initData, startParam, platform, back, openLink, requestPhone, haptic, share, storage}`; конфиг кэшировать в localStorage (DeviceStorage MAX недоступен в вебе).
- Из админки в UI: текст BottomButton, ссылки менеджеру (`tg://`/`max.ru`), `openLink` на оплату — всё с whitelist схем.
- `api.telegram.org` блокируется с российских серверов (по условию задания; в источниках сессии не проверено). Варианты: зарубежный reverse-proxy/Worker, свой Bot API server за туннелем, отправка Telegram-части воркером с доступной сетью. Проверить curl с боевого сервера. Данные клиентов остаются в PostgreSQL на РФ-сервере; прокси передаёт только текст исходящих сообщений. MAX работает напрямую.
- Сервер принимает initData обеих платформ по разным токенам: префикс заголовка `tma` / `max`.
- Короткие коды источников ≤40 символов, чтобы уложиться в лимиты 128 и 512.

### Gaps
- Блокировка `api.telegram.org` и обходы не проверены (нет цитаты).
- Детали `POST /uploads` MAX не раскрыты (страница `/docs-api/methods/POST/uploads/` не вычитана).
- Страница Telegram Mini Apps прочитана на 100 000 из 113 140 символов.
- Лимиты длины сообщений MAX/Telegram не проверены.

---

## 6. Минимальная архитектура и план

### Takeaway
Один aiohttp-сервис + PostgreSQL (~18 таблиц, ~15 эндпоинтов), одна статическая админка (HTML + vanilla JS, открывается владельцем внутри мини-аппа), один фоновый воркер. P0 ≈3–4 сессии, P1 ≈4–5, P2 ≈5–7.

### Cited Findings
- Опорные факты в разделах 1–5 (подписанные launch data, лимиты рассылки, MAX webhooks и `comment_created`, версии Firebase, XSS по MDN).

### Inferences
**Таблицы:** `settings`; `content_versions` + `content_pointers`; `flags`; `promos` + `promo_redemptions`; `experiments`; `events` + `sources`; `users` (+`user_tags`); `consents`; `message_templates` + `followup_rules`; `broadcasts` + `broadcast_jobs`; `scheduled_posts`; `leads`; `audit_log`.

**API:**
- Публичные: `GET /api/config` (ETag), `POST /api/events` (пачкой, rate-limit), `POST /api/promo/check`, `POST /api/lead`, `POST /api/consent`.
- Webhooks: `POST /hook/max` (`message_created`, `message_callback`, `bot_started`, `comment_created`), `POST /hook/tg`.
- Админ (owner-only): `GET/PUT /admin/content/{key}`, `POST …/publish`, `POST …/rollback/{version}`, `GET …/versions`, CRUD flags/promos/templates/sources/rules, `GET /admin/stats/funnel`, `GET /admin/leads`, `POST /admin/broadcast/preview|start`, `GET /admin/audit`.

**Экраны админки:** 1) тексты и услуги (форма по схеме, превью, опубликовать/откатить); 2) цены и калькулятор; 3) акции и промокоды; 4) режим и график; 5) источники; 6) заявки и воронка; 7) шаблоны и рассылки (P2); 8) журнал изменений.

**План (оценки в сессиях — мои прикидки):**
- P0 (≈3–4): БД + `/api/config` с ETag + вшитые defaults + клиентский кэш; валидация initData TG/MAX + owner-only + audit; редактор контента с draft/publish/rollback и валидацией схемой; maintenance, часы, баннер, CSP/`textContent`, события `app_open/lead_sent`.
- P1 (≈4–5): источники и тексты по `start_param`; полная воронка и дашборд; промокоды и сезонные баннеры; флаги; согласия и `/stop`.
- P2 (≈5–7): шаблоны и автоответы; очередь рассылок с сегментами и согласием + предпросмотр «себе»; дожим; реакция на `comment_created`; scheduled posts; эксперименты (при достаточном трафике).
- Рассылки и A/B откладывать, пока нет согласий, юридических документов и трафика.

### Gaps
- Оценки трудозатрат — инженерные прикидки.
- Миграции, бэкапы (pg_dump по расписанию) и юридические документы (политика ПДн, текст согласия на рекламу) вне объёма.
