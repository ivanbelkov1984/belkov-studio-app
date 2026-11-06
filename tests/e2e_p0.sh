#!/usr/bin/env bash
# Сквозной тест P0 (конфиг, версии, откат, Сегодня, поля заявки). Тестовый токен, порт 3099.
set -u
W=$(mktemp -d); chmod 755 $W
cd /srv/studio/api
set -a; . /srv/studio/secrets/db.env; set +a
export TG_BOT_TOKEN=111:TEST OWNER_TG_ID=4242 LEADS_ENABLED=1 PORT=3099 TG_API_ENABLED=0 MAX_BOT_TOKEN= OWNER_MAX_ID= YOOKASSA_SHOP_ID= YOOKASSA_SECRET_KEY=
sudo -E -u studio env HOME=/srv/studio python3 app.py >$W/app.log 2>&1 & APP=$!
sleep 3
INIT=$(python3 - <<'EOF'
import hmac,hashlib,json,time
from urllib.parse import urlencode
d={'auth_date':str(int(time.time())),'user':json.dumps({'id':4242,'first_name':'Test'})}
chk='\n'.join(f'{k}={v}' for k,v in sorted(d.items()))
d['hash']=hmac.new(hmac.new(b'WebAppData',b'111:TEST',hashlib.sha256).digest(),chk.encode(),hashlib.sha256).hexdigest()
print(urlencode(d))
EOF
)
B=http://127.0.0.1:3099/api; H=(-H "Content-Type: application/json" -H "X-Platform: telegram" -H "X-Init-Data: $INIT")
c() { curl -s -o $W/o -w "%{http_code}" "$@"; echo " $(head -c 150 $W/o)"; }
j() { python3 -c "import json;print(json.load(open('$W/o')).get('$1',''))"; }
echo -n "config empty:        "; c $B/config
ETAG=$(curl -si $B/config | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')
echo -n "config 304:          "; curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" $B/config
echo -n "no-auth save:        "; c -X POST $B/admin/config/mode -H "Content-Type: application/json" -d '{"value":{}}'
echo -n "mode v1 (closed):    "; c -X POST "${H[@]}" $B/admin/config/mode -d '{"value":{"closed":true,"closed_text":"Отпуск до 20.11","hours":{"from":"10:00","to":"19:00"}},"note":"тест"}'
echo -n "mode bad hours:      "; c -X POST "${H[@]}" $B/admin/config/mode -d '{"value":{"hours":{"from":"25:00","to":"19:00"}}}'
echo -n "banner bad link:     "; c -X POST "${H[@]}" $B/admin/config/banner -d '{"value":{"enabled":true,"text":"x","button_link":"javascript:alert(1)"}}'
echo -n "banner ok:           "; c -X POST "${H[@]}" $B/admin/config/banner -d '{"value":{"enabled":true,"text":"Ноябрь: бриф бесплатно","button_text":"Открыть","button_link":"#/brief","from":"2026-11-01","to":"2026-11-30"}}'
echo -n "prices bad (<0):     "; c -X POST "${H[@]}" $B/admin/config/prices -d '{"value":{"bot":{"priceFrom":-5}}}'
echo -n "prices ok:           "; c -X POST "${H[@]}" $B/admin/config/prices -d '{"value":{"bot":{"priceFrom":27000},"app":{"hidden":true}}}'
echo -n "unknown block:       "; c -X POST "${H[@]}" $B/admin/config/evil -d '{"value":{}}'
echo -n "sources:             "; c -X POST "${H[@]}" $B/admin/config/sources -d '{"value":{"src_channel":{"title":"Канал","greeting":"Привет из канала"}}}'
echo -n "mode v2 (open):      "; c -X POST "${H[@]}" $B/admin/config/mode -d '{"value":{"closed":false,"hours":{"from":"","to":""}}}'
echo -n "public config:       "; c $B/config
echo -n "versions mode:       "; c "${H[@]}" $B/admin/config/mode/versions
echo -n "rollback to v1:      "; c -X POST "${H[@]}" $B/admin/config/mode/rollback -d '{"version":1}'
echo -n "public mode state:   "; curl -s $B/config | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['state'],d['blocks']['mode']['closed'])"
echo -n "rollback missing:    "; c -X POST "${H[@]}" $B/admin/config/mode/rollback -d '{"version":99}'
# заявка и поля
c -X POST "${H[@]}" $B/lead -d '{"task":"P0 тест","src":"src_channel","consent":true}' >/dev/null; LID=$(j id)
echo -n "today (new, no reply):"; c "${H[@]}" $B/admin/today | cut -c1-110
echo -n "lost w/o reason:     "; c -X PATCH "${H[@]}" $B/admin/leads/$LID -d '{"status":"lost"}'
echo -n "next action:         "; c -X PATCH "${H[@]}" $B/admin/leads/$LID -d '{"status":"work","responded":true,"next_action":"Позвонить","next_action_at":"2020-01-01T10:00","tags":["Горячий","bot!"]}'
echo -n "today (due):         "; curl -s "${H[@]}" $B/admin/today | python3 -c "import json,sys;d=json.load(sys.stdin);print('due',len(d['due']),'new_unanswered',len(d['new_unanswered']),'npd',d['npd']['level'])"
echo -n "lost with reason:    "; c -X PATCH "${H[@]}" $B/admin/leads/$LID -d '{"status":"lost","lost_reason":"цена"}'
echo -n "lead card:           "; curl -s "${H[@]}" $B/admin/leads/$LID | python3 -c "import json,sys;l=json.load(sys.stdin)['lead'];print(l['status'],l['lost_reason'],l['tags'],bool(l['first_response_at']))"
echo -n "no-auth today:       "; curl -s -o /dev/null -w "%{http_code}\n" $B/admin/today
kill $APP; sleep 1
sudo -u postgres psql -q -d studio -c "DELETE FROM leads WHERE task='P0 тест'; DELETE FROM content_pointers; DELETE FROM content_versions; DELETE FROM audit WHERE action LIKE 'content_%' OR detail IN ('lost','work');" && echo "test data cleaned"
grep -iE "traceback|error" $W/app.log | head -5
rm -rf $W
