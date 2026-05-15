#!/bin/bash
# Live HTTP smoke — admin user invite + deactivate.
# Server: localhost:3101 (dev server'in koştuğu varsayilir).
# Token: 5 demo persona'dan ilgili kullaniciyi otomatik token'lar (Test1234!).
# Mutate: yarattigi test verisini sonunda temizler.

set -u

BFF="http://localhost:3101"
SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2)"
SUPABASE_ANON_KEY="$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2)"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "FAIL: Supabase env eksik"
  exit 1
fi

# Get bearer token by signing in with email/password
get_token() {
  local email="$1"
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Test1234!\"}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).access_token||"")}catch(e){console.log("")}})'
}

PASS=0
FAIL=0
TS=$(date +%s)
TEST_EMAIL="curl-smoke-${TS}@varuna.dev"
CREATED_USER_ID=""

expect() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label  (status=$actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label  expected=$expected got=$actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Live HTTP smoke: admin invite + deactivate ==="
echo ""

# Get admin token
echo "--- Token alimi ---"
ADMIN_TOKEN=$(get_token "admin@varuna.dev")
if [ -z "$ADMIN_TOKEN" ]; then
  echo "FAIL: admin@varuna.dev token alinamadi"
  exit 1
fi
echo "  ✓ admin token alindi (length=${#ADMIN_TOKEN})"
PASS=$((PASS+1))

# Get a real companyId from admin's scope
COMPANY_ID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BFF/api/admin/companies" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log((j.value||j)[0]?.id||"")})')
echo "  ✓ admin scope companyId: $COMPANY_ID"

# --- 1) Cross-tenant attempt (admin trying to invite to a company they don't own) ---
echo ""
echo "--- 1) Cross-tenant: admin'in bir Admin kullanicisi (PARAM only) UNIVERA'ya davet etmeye calisirsa 403 ---"
# Need a PARAM-only admin. Demo seed: admin@varuna.dev tum sirketlerin Admin'i; bu testi gercek bir Admin
# kullanicimiz yoksa atlaTmali. Gercek environment'de manuel test ile dogrulanmali.
echo "  ⚠ skipped: demo seed'inde her admin tum sirketlere bagli (cross-tenant senaryosu uretilemiyor)"

# --- 2) Happy path: admin invites new user ---
echo ""
echo "--- 2) Happy path: yeni e-posta davet ---"
# Tek POST: hem status hem response body al
RESP=$(curl -s -w "\n%{http_code}" -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"role\":\"Agent\",\"companyId\":\"$COMPANY_ID\",\"companyRole\":\"Agent\"}" \
  "$BFF/api/admin/users/invite")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
expect "happy path (201)" "201" "$STATUS"
CREATED_USER_ID=$(echo "$BODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).userId||"")}catch(e){console.log("")}})')
echo "    Response: $BODY"
echo "    Created userId: $CREATED_USER_ID"

# --- 3) Duplicate email ---
echo ""
echo "--- 3) Duplicate e-posta tekrar davet → 409 ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"role\":\"Agent\",\"companyId\":\"$COMPANY_ID\",\"companyRole\":\"Agent\"}" \
  "$BFF/api/admin/users/invite")
expect "duplicate email (409)" "409" "$STATUS"

# --- 4) Invalid email format ---
echo ""
echo "--- 4) Geçersiz e-posta formati → 400 ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"email\":\"not-an-email\",\"role\":\"Agent\",\"companyId\":\"$COMPANY_ID\",\"companyRole\":\"Agent\"}" \
  "$BFF/api/admin/users/invite")
expect "invalid email (400)" "400" "$STATUS"

# --- 5) Unauthenticated ---
echo ""
echo "--- 5) Authorization header'sız → 401 ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"x@y.com\",\"role\":\"Agent\",\"companyId\":\"$COMPANY_ID\",\"companyRole\":\"Agent\"}" \
  "$BFF/api/admin/users/invite")
expect "unauthenticated (401)" "401" "$STATUS"

# --- 6) Non-admin user invites → 403 ---
echo ""
echo "--- 6) Agent davet endpoint'ine girmeye calisirsa → 403 ---"
AGENT_TOKEN=$(get_token "agent@varuna.dev")
if [ -n "$AGENT_TOKEN" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"x@y.com\",\"role\":\"Agent\",\"companyId\":\"$COMPANY_ID\",\"companyRole\":\"Agent\"}" \
    "$BFF/api/admin/users/invite")
  expect "agent → forbidden (403)" "403" "$STATUS"
else
  echo "  ⚠ skipped: agent token alinamadi"
fi

# --- 7) Deactivate happy path ---
echo ""
echo "--- 7) Deactivate happy path (yarattigimiz kullaniciyi pasif et) ---"
if [ -n "$CREATED_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BFF/api/admin/users/$CREATED_USER_ID/deactivate")
  expect "deactivate (200)" "200" "$STATUS"
else
  echo "  ⚠ skipped: CREATED_USER_ID yok"
fi

# --- 8) Deactivate self → 400 ---
echo ""
echo "--- 8) Admin kendi hesabini deactivate etmeye calisirsa → 400 ---"
# Get admin user id from token
ME=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BFF/api/auth/me" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id||"")}catch(e){console.log("")}})')
if [ -n "$ME" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BFF/api/admin/users/$ME/deactivate")
  expect "self deactivate → 400" "400" "$STATUS"
else
  echo "  ⚠ skipped: admin id alinamadi"
fi

# --- 9) Cleanup: DB'den test user'i sil ---
echo ""
echo "--- Cleanup ---"
if [ -n "$CREATED_USER_ID" ]; then
  node --env-file=.env -e "
    import('./server/db/client.js').then(async ({prisma})=>{
      await prisma.userCompany.deleteMany({where:{userId:'$CREATED_USER_ID'}});
      await prisma.user.delete({where:{id:'$CREATED_USER_ID'}}).catch(()=>{});
      // Supabase tarafindan da sil:
      const {createClient}=await import('@supabase/supabase-js');
      const sb=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
      await sb.auth.admin.deleteUser('$CREATED_USER_ID').catch(()=>{});
      console.log('  ✓ test verisi temizlendi (DB + Supabase)');
      await prisma.\$disconnect();
    });
  "
fi

echo ""
echo "=== $PASS/$((PASS+FAIL)) passed ==="
[ "$FAIL" = "0" ] || exit 1
