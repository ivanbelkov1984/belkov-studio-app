-- Пульт студии: схема БД (PostgreSQL). Идемпотентна: можно применять повторно.

CREATE TABLE IF NOT EXISTS leads (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  platform        text NOT NULL,                 -- telegram | max | web
  user_id         text,                          -- id из подписанных данных запуска (для ответа)
  username        text,
  name            text,
  contact         text,                          -- для веб-версии: как связаться
  biz             text,
  svc             text,
  task            text NOT NULL,
  budget          text,
  when_text       text,
  calc            text,
  src             text,
  consent_at      timestamptz NOT NULL,
  consent_version text NOT NULL,
  status          text NOT NULL DEFAULT 'new',   -- new | work | offer | contract | done | lost
  note            text
);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_messages (
  id         bigserial PRIMARY KEY,
  lead_id    bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  direction  text NOT NULL,                      -- out (ответ владельца)
  text       text NOT NULL,
  ok         boolean NOT NULL DEFAULT true,
  error      text
);

-- Обезличенная воронка: только счётчики по дням, без персональных данных.
CREATE TABLE IF NOT EXISTS events (
  day   date NOT NULL,
  type  text NOT NULL,                           -- open | calc | brief | lead
  src   text NOT NULL DEFAULT '',
  plat  text NOT NULL DEFAULT '',
  n     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type, src, plat)
);

CREATE TABLE IF NOT EXISTS posts (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  send_at     timestamptz NOT NULL DEFAULT now(),
  text        text NOT NULL,
  photo_url   text,
  button      boolean NOT NULL DEFAULT true,
  targets     text NOT NULL DEFAULT 'telegram,max',
  status      text NOT NULL DEFAULT 'scheduled', -- scheduled | sent | partial | failed | canceled
  result      jsonb
);

-- Журнал действий с персональными данными (удаления, ответы, смена статуса).
CREATE TABLE IF NOT EXISTS audit (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  action  text NOT NULL,
  lead_id bigint,
  detail  text
);

-- Счета на оплату через ЮKassa (самозанятый: чек оформляется в «Мой налог», receipt не передаётся).
CREATE TABLE IF NOT EXISTS invoices (
  id                  bigserial PRIMARY KEY,
  public_id           text UNIQUE NOT NULL,          -- в ссылке для клиента
  lead_id             bigint REFERENCES leads(id) ON DELETE SET NULL,
  title               text NOT NULL,
  amount_rub          integer NOT NULL CHECK (amount_rub > 0),
  status              text NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | paid | canceled
  provider_payment_id text,                          -- последний созданный платёж ЮKassa
  payment_ref         text UNIQUE,                   -- id успешного платежа (защита от двойного учёта)
  receipt_done        boolean NOT NULL DEFAULT false,-- чек в «Мой налог» пробит
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status, created_at DESC);

-- P0 пульта-CRM: управляемый контент с версиями и откатом
CREATE TABLE IF NOT EXISTS content_versions (
  id         bigserial PRIMARY KEY,
  key        text NOT NULL,
  version    integer NOT NULL,
  value      jsonb NOT NULL,
  author     text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
CREATE TABLE IF NOT EXISTS content_pointers (
  key        text PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES content_versions(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Поля заявки: следующее действие, причина потери, время первого ответа, теги
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
