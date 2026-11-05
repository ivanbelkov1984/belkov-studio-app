# Резервные копии сервера и восстановление

Сервер: FirstVDS VDS #18909404 (Москва). Хранилище копий: S3 FirstVDS (РФ), бакет `belkov-backups-studio`, 250 ₽/мес за 100 ГБ (сверх — 2,5 ₽/ГБ).

## Что копируется
Каждую ночь в 03:17 МСК (`/usr/local/bin/apps-backup.sh`, systemd-cron):
- `/srv/studio/data`, `/srv/music/data` (песни и данные; неизменные файлы заливаются один раз);
- дамп PostgreSQL `music_bot`.
Инструмент: restic (шифрование, дедупликация). Хранение: 14 дней, 8 недель, 6 месяцев. Локально на сервере дополнительно 14 дней age-дампов БД в `/var/backups/apps`.

## Где секреты (не в репозитории)
- Ключ S3 и пароль репозитория: на сервере `/root/backup/s3.env`, `/root/backup/restic.pass` (root, 600).
- Копия пароля репозитория и закрытый ключ age для дампов БД: у владельца в `E:\IVAN_WORKSTATION\Backups\age-keys\`. Дублировать на флешку или в менеджер паролей. **Без пароля репозитория копии не открыть.**
- Ключи доступа S3 можно перевыпустить в панели FirstVDS: S3 хранилище, Доступы, «Сменить ключи» (после смены обновить `/root/backup/s3.env`).

## Восстановление (на новом сервере)
1. `apt install restic`, положить `s3.env` (ключи S3, `S3_HOST=firsts3.ru`) и `restic.pass`.
2. `set -a; . s3.env; set +a; export RESTIC_PASSWORD_FILE=restic.pass RESTIC_REPOSITORY=s3:https://firsts3.ru/belkov-backups-studio`
3. `restic snapshots` и `restic restore latest --target /tmp/restore`
4. Данные: перенести `/tmp/restore/srv/...` в `/srv/...`; базу: `pg_restore -d music_bot /tmp/restore/var/backups/apps/music-db-latest.dump`.
   Восстанавливать от root (`restic restore` сохраняет владельца), затем проверить `ls -ld /srv/music/data/audio` — владелец должен быть 10001.

Проверено 06.11.2026: восстановление и `restic check` успешны.
