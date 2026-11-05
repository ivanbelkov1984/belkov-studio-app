// Настройки мини-приложения «Студия Белькова». Секретов здесь нет и быть не должно.
// null — кнопка или блок скрыты, пока Иван не даст ссылку.
export const CONFIG = {
  studio: 'Студия Белькова',
  // Куда уходит заявка. Telegram: имя пользователя без @. MAX: полная ссылка на чат/бота.
  telegramUsername: 'belkov_ivan',
  maxContactUrl: null,
  phone: null,               // '+7 (xxx) xxx-xx-xx' — только если Иван разрешит публиковать
  // Каналы
  telegramChannel: null,     // 'https://t.me/...'
  maxChannel: null,          // 'https://max.ru/...'
  musicTelegram: 'https://t.me/belkovsongbot', // музыкальный бот в Telegram
  musicMax: null,            // музыкальный канал в MAX
  // Кейс
  triumfDemo: 'https://t.me/TriumphMoto_bot/catalog?startapp=src_studio',
};
