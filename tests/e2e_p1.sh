#!/usr/bin/env bash
# Сквозной тест P1 на отдельной тестовой базе и порту 3099.
set -u
W=$(mktemp -d); chmod 755 $W
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname='studio_t1'" | grep -q 1 || sudo -u postgres createdb -O studio_api studio_t1
. /srv/studio/secrets/db.env
export DATABASE_URL="${DATABASE_URL%/*}/studio_t1"
cd /srv/studio/api
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
c() { curl -s -o $W/o -w "%{http_code}" "$@"; echo " $(head -c 140 $W/o)"; }
j() { python3 -c "import json;print(json.load(open('$W/o')).get('$1',''))"; }
echo -n "templates ok:        "; c -X POST "${H[@]}" $B/admin/config/templates -d '{"value":[{"title":"Спасибо","text":"Спасибо за заявку!"}]}'
echo -n "templates too long:  "; c -X POST "${H[@]}" $B/admin/config/templates -d "{\"value\":[{\"title\":\"x\",\"text\":\"$(python3 -c 'print("a"*1001)')\"}]}"
echo -n "promos both fields:  "; c -X POST "${H[@]}" $B/admin/config/promos -d '{"value":{"BAD":{"percent":10,"amount":500}}}'
echo -n "promos bad pct:      "; c -X POST "${H[@]}" $B/admin/config/promos -d '{"value":{"BAD":{"percent":95}}}'
echo -n "promos bad code:     "; c -X POST "${H[@]}" $B/admin/config/promos -d '{"value":{"плохой":{"percent":10}}}'
echo -n "promos ok:           "; c -X POST "${H[@]}" $B/admin/config/promos -d '{"value":{"start10":{"percent":10,"title":"Старт"},"OLD":{"percent":5,"to":"2020-01-01"},"ONE":{"amount":1000,"limit":1}}}'
echo -n "flags bad platform:  "; c -X POST "${H[@]}" $B/admin/config/flags -d '{"value":{"calc":{"on":true,"platforms":["tiktok"]}}}'
echo -n "flags ok:            "; c -X POST "${H[@]}" $B/admin/config/flags -d '{"value":{"calc":{"on":true,"platforms":["max","telegram"],"percent":50}}}'
echo -n "mode ack:            "; c -X POST "${H[@]}" $B/admin/config/mode -d '{"value":{"ack_text":"Заявка получена, ответим в течение дня.","hours":{"from":"","to":""}}}'
echo -n "public config keys:  "; curl -s $B/config | python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted(d['blocks']),'has_promos',d['has_promos'],'LEAK' if ('promos' in d['blocks'] or 'templates' in d['blocks']) else 'no-leak')"
echo -n "promo START10 (case): "; c -X POST $B/promo/check -H "Content-Type: application/json" -d '{"code":"start10"}'
echo -n "promo OLD expired:   "; c -X POST $B/promo/check -H "Content-Type: application/json" -d '{"code":"OLD"}'
echo -n "promo unknown:       "; c -X POST $B/promo/check -H "Content-Type: application/json" -d '{"code":"NOPE"}'
echo -n "lead with promo:     "; c -X POST "${H[@]}" $B/lead -d '{"task":"=HYPERLINK(\"x\")","src":"channel","promo":"start10","consent":true}'; L1=$(j id)
echo -n "lead bad promo:      "; c -X POST "${H[@]}" $B/lead -d '{"task":"P1 второй","promo":"NOPE","consent":true}'; L2=$(j id)
echo -n "promo ONE usage 1:   "; c -X POST "${H[@]}" $B/lead -d '{"task":"P1 третий","promo":"ONE","consent":true}' ;
echo -n "promo ONE exhausted: "; c -X POST $B/promo/check -H "Content-Type: application/json" -d '{"code":"ONE"}'
echo -n "lead card:           "; curl -s "${H[@]}" $B/admin/leads/$L1 | python3 -c "import json,sys;d=json.load(sys.stdin);print('promo',d['lead']['promo_code'],'notes',len(d['notes']))"
echo -n "bad promo stored:    "; curl -s "${H[@]}" $B/admin/leads/$L2 | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['lead']['promo_code'])"
echo -n "note add:            "; c -X POST "${H[@]}" $B/admin/leads/$L1/notes -d '{"text":"Созвонились, ждём бриф"}'
echo -n "note empty:          "; c -X POST "${H[@]}" $B/admin/leads/$L1/notes -d '{"text":"  "}'
echo -n "note no-auth:        "; c -X POST $B/admin/leads/$L1/notes -H "Content-Type: application/json" -d '{"text":"x"}'
echo -n "notes in card:       "; curl -s "${H[@]}" $B/admin/leads/$L1 | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['notes']),d['notes'][0]['text'])"
echo -n "metrics:             "; c "${H[@]}" "$B/admin/metrics?days=30"
echo -n "metrics no-auth:     "; curl -s -o /dev/null -w "%{http_code}\n" $B/admin/metrics
echo -n "csv header/inject:   "; curl -s "${H[@]}" $B/admin/export/leads.csv | python3 -c "
import sys;t=sys.stdin.read();lines=t.splitlines();print(lines[0][:60].replace('﻿','<BOM>'));print([l for l in lines if 'HYPERLINK' in l][0][:90])"
echo -n "csv no-auth:         "; curl -s -o /dev/null -w "%{http_code}\n" $B/admin/export/leads.csv
kill $APP; sleep 1
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS studio_t1" && echo "test db dropped"
grep -iE "traceback|error" $W/app.log | head -5
rm -rf $W
