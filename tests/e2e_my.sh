#!/usr/bin/env bash
# «Мои заявки» и удаление данных клиентом. Запуск на сервере: sudo bash e2e_my.sh
set -u
W=$(mktemp -d); chmod 755 $W
sudo -u postgres createdb -O studio_api studio_t2 2>/dev/null
. /srv/studio/secrets/db.env; export DATABASE_URL="${DATABASE_URL%/*}/studio_t2"
cd /srv/studio/api
export TG_BOT_TOKEN=111:TEST OWNER_TG_ID=4242 LEADS_ENABLED=1 PORT=3098 TG_API_ENABLED=0 MAX_BOT_TOKEN= OWNER_MAX_ID= YOOKASSA_SHOP_ID= YOOKASSA_SECRET_KEY=
sudo -E -u studio env HOME=/srv/studio python3 app.py >$W/log 2>&1 & APP=$!
sleep 3
mk(){ python3 - "$1" <<'PY'
import hmac,hashlib,json,time,sys
from urllib.parse import urlencode
d={'auth_date':str(int(time.time())),'user':json.dumps({'id':int(sys.argv[1]),'first_name':'T'})}
chk='\n'.join(f'{k}={v}' for k,v in sorted(d.items()))
d['hash']=hmac.new(hmac.new(b'WebAppData',b'111:TEST',hashlib.sha256).digest(),chk.encode(),hashlib.sha256).hexdigest()
print(urlencode(d))
PY
}
A=$(mk 4242); B=$(mk 777); U=http://127.0.0.1:3098/api
ha=(-H "Content-Type: application/json" -H "X-Platform: telegram" -H "X-Init-Data: $A"); hb=(-H "Content-Type: application/json" -H "X-Platform: telegram" -H "X-Init-Data: $B")
curl -s "${hb[@]}" $U/lead -d '{"task":"Нужен бот","consent":true}' >/dev/null
curl -s "${ha[@]}" $U/lead -d '{"task":"Чужая заявка","consent":true}' >/dev/null
echo "my B (1 заявка):  $(curl -s "${hb[@]}" $U/my | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["leads"]))')"
echo "my web 401:       $(curl -s -o /dev/null -w %{http_code} $U/my)"
echo "my fake 401:      $(curl -s -o /dev/null -w %{http_code} -H 'X-Platform: telegram' -H 'X-Init-Data: hash=x' $U/my)"
echo "B видит чужую (0): $(curl -s "${hb[@]}" $U/my | python3 -c 'import json,sys;print(sum("Чужая" in l["task"] for l in json.load(sys.stdin)["leads"]))')"
echo "delete web 401:   $(curl -s -o /dev/null -w %{http_code} -X POST $U/my/delete)"
echo "delete B:         $(curl -s -X POST "${hb[@]}" $U/my/delete)"
echo "my B после (0):   $(curl -s "${hb[@]}" $U/my | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["leads"]))')"
echo "A цела (1):       $(curl -s "${ha[@]}" $U/my | python3 -c 'import json,sys;print(sum("Чужая" in l["task"] for l in json.load(sys.stdin)["leads"]))')"
kill $APP; sleep 1; sudo -u postgres psql -q -c "DROP DATABASE studio_t2"; grep -iE "traceback" $W/log | head -3; rm -rf $W
