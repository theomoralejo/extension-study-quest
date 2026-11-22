#!/usr/bin/env bash
# Publica a API das respostas no attrio-ded (container rootless study-quest-api, conta attriostudio).
# Uso, do checkout local: backend-api/scripts/deploy.sh
# Faz backup do que está no ar, copia app.js/server.js/package*.json, reinicia (restart, nunca recria:
# recriar sorteia porta e quebra a rota do Caddy) e exige /api/health 200; senão volta o backup.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/home/attriostudio/docker-data/volumes/attriostudio_html_data/_data/study-quest-api
CARIMBO=$(date -u +%Y%m%dT%H%M%SZ)
ARQS="app.js server.js package.json package-lock.json"

node --test test/*.test.mjs >/dev/null || { echo "testes falharam: nada publicado"; exit 1; }
tar czf - $ARQS | ssh -o BatchMode=yes attrio-ded "cat > /tmp/sq-api-$CARIMBO.tgz"
ssh -o BatchMode=yes attrio-ded "sudo -n bash -s" <<EOF
set -euo pipefail
B=$DIR/_backup-$CARIMBO; mkdir -p \$B
for f in $ARQS; do if [ -f $DIR/\$f ]; then cp -p $DIR/\$f \$B/; fi; done
tar xzf /tmp/sq-api-$CARIMBO.tgz -C $DIR && rm /tmp/sq-api-$CARIMBO.tgz
chown attriostudio:attriostudio $DIR/{app.js,server.js,package.json,package-lock.json}
su - attriostudio -c "XDG_RUNTIME_DIR=/run/user/\\\$(id -u attriostudio) podman restart study-quest-api" >/dev/null
for i in \$(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:34003/api/health; then echo "publicado; backup em \$B"; exit 0; fi
  sleep 1
done
echo "health não respondeu: voltando o backup \$B"
cp -p \$B/* $DIR/
su - attriostudio -c "XDG_RUNTIME_DIR=/run/user/\\\$(id -u attriostudio) podman restart study-quest-api" >/dev/null
exit 1
EOF
