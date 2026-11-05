# Сервер для музыки: что готово и как запускать

Сервер: FirstVDS VDS #18909404, Москва, Ubuntu 24.04, 2 ядра / 2 ГБ ОЗУ / диск 20 ГБ (+ swap 2 ГБ). Адрес: `https://music.aiservicesint.ru`.

## Готово со стороны сервера
- HTTPS (Let's Encrypt), автопродление. nginx проксирует `/webhook|health|static|api|order|player|miniapp` на `127.0.0.1:8080`, лимит тела запроса 50 МБ.
- Пользователь `music` (SSH по ключу, в группе `docker`). Каталоги: `/srv/music/app`, `/srv/music/data` (песни и данные, **входит в резервные копии**), `/srv/music/logs`, `/srv/music/secrets` (700).
- PostgreSQL 16: база `music_bot`, роль `music_bot`; строка подключения в `/srv/music/secrets/db.env` (600). Postgres слушает только `localhost` (из контейнера: `--network host` и `127.0.0.1:5432`).
- Резервные копии: ночью 03:17 МСК, restic -> S3 (РФ) + дамп БД. Хранение 14 дней, 8 недель, 6 месяцев. Восстановление: `docs/BACKUP-RESTORE.md`.
- Docker: ротация логов 20 МБ x 5, образы `tmb-music:cand*` (3 шт.) уже собраны.
- Файрвол: открыты только 22, 80, 443. fail2ban и автообновления безопасности включены.

## Как запускать (шаблон)
```
docker run -d --name tmb-music --restart unless-stopped --network host \
  --env-file /srv/music/secrets/.env --env-file /srv/music/secrets/db.env \
  -e AUDIO_DIR=/app/data/audio \
  -v /srv/music/data:/app/data -v /srv/music/logs/app:/app/logs \
  tmb-music:<тег>
```
Контейнер работает от uid 10001: каталоги `/srv/music/logs/app` и `/srv/music/data/audio` принадлежат 10001 (права 750), `/srv/music/data` — 751. Песни: `/srv/music/data/audio/<song_id>.mp3`.
Приложение должно слушать `127.0.0.1:8080`. Проверка: `curl https://music.aiservicesint.ru/health`.
Токены и ключи кладёт владелец в `/srv/music/secrets/.env` (600), в репозиторий и чат не попадают.

## Правила
- Все песни и пользовательские файлы только в `/srv/music/data`, под неизменными именами (иначе не попадут в копию или будут перезаливаться). Не хранить их внутри образа.
- Прод не включать, пока владелец не скажет «переключай». Перед включением: вебхуки ботов на `https://music.aiservicesint.ru/webhook...`, старый хостинг остановить в тот же момент.
- Диск 20 ГБ: оценка 300 песен х 6 МБ = около 2 ГБ плюс образы 1,8 ГБ. Старые образы `cand*` удалить после выбора рабочего.
- Перед запуском с реальными пользователями данные россиян хранить только на этом сервере (ч. 5 ст. 18 152-ФЗ); иностранные облака для данных пользователей не подключать.
