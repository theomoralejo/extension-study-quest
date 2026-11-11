#!/usr/bin/env bash
#
# Empacota a extensao para cada navegador a partir de uma lista EXPLICITA de
# arquivos.
#
# Por que lista explicita e nao "a pasta inteira": empacotar o diretorio do
# repositorio leva junto o que nao e a extensao — `backend-api/` (o servidor,
# com a logica de acesso ao banco), os utilitarios de `scripts/` e qualquer
# arquivo novo que alguem largar na raiz. Tudo que entra no pacote e legivel
# por quem instala.
#
# Uso:
#   ./scripts/build.sh            # gera dist/ + zips de Chrome/Edge e Firefox
#   ./scripts/build.sh --safari   # gera tambem o projeto Xcode do Safari
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/extension"

# Unica lista do que compoe a extensao. Arquivo novo so entra no pacote
# depois de ser adicionado aqui, de proposito.
FILES=(
  manifest.json
  browser-api.js
  config.js
  content.js
  zoho-api.js
  drag.js
  placeholders.js
  field-history.js
  notes-panel.js
  popup.html
  popup.css
  popup.js
  styles.css
  field-history.css
  notes-panel.css
)
DIRS=(
  icons
)

echo "==> limpando $DIST"
rm -rf "$DIST"
mkdir -p "$STAGE"

echo "==> copiando arquivos da extensao"
for f in "${FILES[@]}"; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "ERRO: arquivo declarado mas ausente: $f" >&2
    exit 1
  fi
  cp "$ROOT/$f" "$STAGE/$f"
done
for d in "${DIRS[@]}"; do
  if [[ ! -d "$ROOT/$d" ]]; then
    echo "ERRO: diretorio declarado mas ausente: $d" >&2
    exit 1
  fi
  cp -R "$ROOT/$d" "$STAGE/$d"
done

# O macOS carrega atributos estendidos (quarentena, Finder info) nos arquivos,
# e o `cp` os preserva. A assinatura do Safari recusa o pacote com eles:
# "resource fork, Finder information, or similar detritus not allowed".
xattr -cr "$STAGE" 2>/dev/null || true

# Guarda: nada do servidor pode ter entrado no pacote.
if find "$STAGE" -name 'server.js' -o -name '.env*' -o -name 'package-lock.json' | grep -q .; then
  echo "ERRO: arquivo de backend/segredo dentro do pacote da extensao" >&2
  exit 1
fi

VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/manifest.json'))['version'])")"
echo "==> versao $VERSION"

echo "==> zip Chrome / Edge"
( cd "$STAGE" && zip -qr "$DIST/study-quest-extension-chrome-$VERSION.zip" . )

echo "==> zip Firefox"
( cd "$STAGE" && zip -qr "$DIST/study-quest-extension-firefox-$VERSION.zip" . )

echo "==> lint Firefox (web-ext)"
npx --yes web-ext@latest lint --source-dir="$STAGE" --output=json > "$DIST/lint.json" 2>/dev/null || true
python3 - "$DIST/lint.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
s = d.get('summary', {})
print(f"    erros={s.get('errors',0)} avisos={s.get('warnings',0)} notices={s.get('notices',0)}")
for level in ('errors', 'warnings'):
    for i in d.get(level, []):
        print(f"    [{level}] {i.get('code')}: {i.get('description','')[:100]}")
if s.get('errors', 0):
    sys.exit(1)
PY

if [[ "${1:-}" == "--safari" ]]; then
  APP_NAME="Study Quest Extension"
  APP_ID="com.attriostudio.studyquest.Study-Quest-Extension"

  # O projeto Xcode e gerado FORA do repositorio, por dois motivos:
  # e artefato derivado (nao se versiona) e, principalmente, arquivos dentro
  # da pasta do usuario carregam o xattr `com.apple.provenance`, que o
  # `xattr -c` nao remove e faz a assinatura falhar com "detritus not allowed".
  SAFARI_WORK="$(mktemp -d "${TMPDIR:-/tmp}/sq-safari.XXXXXX")"
  SAFARI_STAGE="$SAFARI_WORK/extension"
  SAFARI_DIR="$SAFARI_WORK/project"

  # `ditto --norsrc --noextattr` copia sem resource fork nem xattr.
  ditto --norsrc --noextattr "$STAGE" "$SAFARI_STAGE"

  echo "==> projeto Safari (em $SAFARI_WORK)"
  xcrun safari-web-extension-converter "$SAFARI_STAGE" \
    --project-location "$SAFARI_DIR" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$APP_ID" \
    --macos-only --swift --copy-resources --no-open --no-prompt --force

  PROJ="$SAFARI_DIR/$APP_NAME/$APP_NAME.xcodeproj/project.pbxproj"

  # O conversor deriva o id do app do NOME e o do appex do --bundle-identifier,
  # e os dois nao batem: o Xcode exige que o binario embutido seja prefixado
  # pelo id do app, senao o build para em ValidateEmbeddedBinary.
  echo "==> alinhando bundle identifier do appex"
  sed -i '' -E "s#PRODUCT_BUNDLE_IDENTIFIER = \"?${APP_ID}\.Extension\"?;#PRODUCT_BUNDLE_IDENTIFIER = \"${APP_ID}.Extension\";#g" "$PROJ"
  sed -i '' -E "s#PRODUCT_BUNDLE_IDENTIFIER = [^;]*\.extension\.Extension;#PRODUCT_BUNDLE_IDENTIFIER = \"${APP_ID}.Extension\";#g" "$PROJ"

  echo "==> build Safari (assinatura ad-hoc, apenas para teste local)"
  xcodebuild -project "$SAFARI_DIR/$APP_NAME/$APP_NAME.xcodeproj" \
    -scheme "$APP_NAME" -configuration Release \
    -derivedDataPath "$SAFARI_DIR/build" \
    CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="" \
    build | tail -3

  # Traz de volta so o resultado: o .app para teste local e o projeto, caso
  # alguem precise abrir no Xcode para assinar com a conta Apple Developer.
  mkdir -p "$DIST/safari"
  ditto --norsrc --noextattr \
    "$SAFARI_DIR/build/Build/Products/Release/$APP_NAME.app" \
    "$DIST/safari/$APP_NAME.app"
  ditto --norsrc --noextattr "$SAFARI_DIR/$APP_NAME" "$DIST/safari/project"
  rm -rf "$SAFARI_WORK"

  echo ""
  echo "    App para teste local: $DIST/safari/$APP_NAME.app"
  echo "    Projeto Xcode:        $DIST/safari/project"
  echo "    Para DISTRIBUIR e preciso assinar com uma conta Apple Developer."
fi

echo ""
echo "==> pronto. Artefatos em $DIST:"
ls -la "$DIST" | grep -v '^total'
