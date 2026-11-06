#!/usr/bin/env bash
# Сквозной тест оплаты через имитацию ЮKassa. Реальные ключи и деньги не используются.
set -u
W=$(mktemp -d); chmod 755 $W
cat > $W/mock.py <<'EOF'
import json, uuid
from aiohttp import web
P = {}
async def create(r):
    assert r.headers.get("Idempotence-Key") and r.headers.get("Authorization", "").startswith("Basic ")
    b = await r.json(); pid = "mock-" + uuid.uuid4().hex[:12]
    assert "receipt" not in b
    P[pid] = {"id": pid, "status": "pending", "paid": False, "amount": b["amount"], "metadata": b["metadata"],
              "confirmation": {"type": "redirect", "confirmation_url": "https://yoomoney.ru/checkout/mock/" + pid}}
    return web.json_response(P[pid])
async def get(r):
    p = P.get(r.match_info["id"]); return web.json_response(p) if p else web.json_response({"code": "not_found"}, status=404)
async def succeed(r):
    p = P[r.match_info["id"]]; p.update(status="succeeded", paid=True)
    if r.query.get("amount"): p["amount"] = {"value": r.query["amount"], "currency": "RUB"}
    return web.json_response(p)
async def last(r): return web.json_response({"id": list(P)[-1]})
app = web.Application(); app.router.add_post("/payments", create); app.router.add_get("/payments/{id}", get)
app.router.add_post("/mock/succeed/{id}", succeed); app.router.add_get("/mock/last", last)
web.run_app(app, host="127.0.0.1", port=3098, print=None)
EOF
python3 $W/mock.py >$W/mock.log 2>&1 & MOCK=$!
cd /srv/studio/api
set -a; . /srv/studio/secrets/db.env; set +a
export TG_BOT_TOKEN=111:TEST OWNER_TG_ID=4242 PORT=3099 TG_API_ENABLED=0 MAX_BOT_TOKEN= OWNER_MAX_ID= \
  YOOKASSA_SHOP_ID=000000 YOOKASSA_SECRET_KEY=test_mock YOOKASSA_API_BASE=http://127.0.0.1:3098
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
c() { curl -s -o $W/o -w "%{http_code}" "$@"; echo " $(head -c 170 $W/o)"; }
j() { python3 -c "import json,sys;print(json.load(open('$W/o')).get('$1',''))"; }
echo -n "create invoice:     "; c -X POST "${H[@]}" $B/admin/invoices -d '{"title":"E2E предоплата","amount_rub":1500}'
PUB=$(j link | sed 's/.*pay=//'); IID=$(j id)
echo -n "pay info public:    "; c $B/pay/$PUB
echo -n "pay start:          "; c -X POST $B/pay/$PUB
echo -n "pay start again (reuse pending): "; c -X POST $B/pay/$PUB
PID=$(curl -s http://127.0.0.1:3098/mock/last | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -X POST http://127.0.0.1:3098/mock/succeed/$PID >/dev/null
echo -n "pay info after paid (refresh): "; c $B/pay/$PUB
echo -n "pay start on paid:  "; c -X POST $B/pay/$PUB
echo -n "receipt mark:       "; c -X POST "${H[@]}" $B/admin/invoices/$IID/receipt
# второй счёт: подтверждение через уведомление
c -X POST "${H[@]}" $B/admin/invoices -d '{"title":"E2E webhook","amount_rub":700}' >/dev/null; PUB2=$(j link | sed 's/.*pay=//')
curl -s -X POST $B/pay/$PUB2 >/dev/null; PID2=$(curl -s http://127.0.0.1:3098/mock/last | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -X POST http://127.0.0.1:3098/mock/succeed/$PID2 >/dev/null
echo -n "webhook succeeded:  "; c -X POST $B/payments/yookassa -H "Content-Type: application/json" -d "{\"type\":\"notification\",\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$PID2\"}}"
echo -n "webhook duplicate:  "; c -X POST $B/payments/yookassa -H "Content-Type: application/json" -d "{\"type\":\"notification\",\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$PID2\"}}"
echo -n "webhook forged id:  "; c -X POST $B/payments/yookassa -H "Content-Type: application/json" -d '{"event":"payment.succeeded","object":{"id":"mock-forged"}}'
# третий: сумма не совпала
c -X POST "${H[@]}" $B/admin/invoices -d '{"title":"E2E mismatch","amount_rub":900}' >/dev/null; PUB3=$(j link | sed 's/.*pay=//')
curl -s -X POST $B/pay/$PUB3 >/dev/null; PID3=$(curl -s http://127.0.0.1:3098/mock/last | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -X POST "http://127.0.0.1:3098/mock/succeed/$PID3?amount=1.00" >/dev/null
echo -n "amount mismatch:    "; c -X POST $B/payments/yookassa -H "Content-Type: application/json" -d "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"$PID3\"}}"
echo -n "pay info mismatch:  "; c $B/pay/$PUB3
echo -n "admin list:         "; c "${H[@]}" $B/admin/invoices
echo -n "no-auth admin:      "; c $B/admin/invoices
kill $APP $MOCK; sleep 1
sudo -u postgres psql -q -d studio -c "DELETE FROM invoices WHERE title LIKE 'E2E%'; DELETE FROM audit WHERE detail LIKE 'invoice %';" && echo "test data cleaned"
grep -iE "traceback|error" $W/app.log | grep -v "notify_owner" | head -5
rm -rf $W
