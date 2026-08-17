#!/bin/bash
# Generated for @dsh-external/dsh-llm-retry-settings.
# Build: compile src/ → lib/ with the dsh checkout's tsc.
# Requires DSH_CHECKOUT pointing at a dsh source checkout (auto-probe below).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# DSH_CHECKOUT 探测：环境变量 → 常见路径（home 下 dsh-harness）
CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/packages" ]; then CHECKOUT="$candidate"; break; fi
  done
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then
  echo "build: cannot locate the dsh checkout (set DSH_CHECKOUT)" >&2
  exit 1
fi

TSCJS="$CHECKOUT/node_modules/typescript/bin/tsc"
if [ ! -f "$TSCJS" ]; then
  echo "build: tsc not found at $TSCJS" >&2
  exit 1
fi

# 宿主侧无运行时依赖（无裸导入），仅需 @types/node 编译类型。
link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$1" "$target"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai
node -e "const fs=require('fs');fs.rmSync('node_modules/@standard-schema',{recursive:true,force:true})"
link_pkg cordis vendor/cordis
link_pkg cosmokit vendor/cosmokit
link_pkg schemastery vendor/schemastery
link_pkg @deepseek-ai/schemastery vendor/schemastery
link_pkg @deepseek-ai/dsh-settings packages/settings/settings
link_pkg @types/node node_modules/@types/node

STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1 || true)
if [ -n "$STD_SCHEMA" ]; then
  node -e "
    const fs = require('fs');
    const path = require('path');
    fs.rmSync('node_modules/@standard-schema', { recursive: true, force: true });
    fs.mkdirSync('node_modules/@standard-schema', { recursive: true });
    fs.symlinkSync(path.resolve(process.argv[1]), path.resolve('node_modules/@standard-schema/spec'), process.platform === 'win32' ? 'junction' : 'dir');
  " "$STD_SCHEMA/node_modules/@standard-schema/spec"
fi

echo "=== Compiling src → lib (tsc $(node "$TSCJS" --version)) ==="
node "$TSCJS" -p tsconfig.json

echo "=== Bundling lib/index.js (esbuild) ==="
node "$ROOT/node_modules/esbuild/bin/esbuild" src/index.ts \
  --bundle --format=esm --platform=node --target=node20 \
  --outfile=lib/index.js --log-level=warning

echo "=== Bundling lib/client.js (esbuild; __ModuleLoader__ handoff) ==="
node "$ROOT/node_modules/esbuild/bin/esbuild" src/client/index.jsx \
  --bundle --format=cjs --platform=browser --jsx=automatic \
  --external:react --external:react/jsx-runtime --external:@deepseek-ai/dsh-client-web-react \
  --outfile=lib/.client.raw.js --log-level=warning
node -e "
const fs = require('fs');
const raw = fs.readFileSync('lib/.client.raw.js', 'utf8');
const out = 'window.__ModuleLoader__.load({\n\tid: \"@dsh-external/dsh-llm-retry-settings\",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n' + raw + '\n\t\treturn module.exports;\n\t}\n});\n';
fs.writeFileSync('lib/client.js', out);
fs.rmSync('lib/.client.raw.js', { force: true });
console.log('lib/client.js written (' + out.length + ' bytes)');
"
echo "=== Build complete ==="
