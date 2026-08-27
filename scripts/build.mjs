/**
 * 构建脚本（跨平台 node 版，替代依赖 bash 的 scripts/build.sh）：
 *   1. 宿主：src/index.ts → lib/index.js（ESM 自包含 bundle，node20）
 *   2. 客户端：src/client/index.jsx → CJS bundle → 包 window.__ModuleLoader__.load 壳 → lib/client.js
 *
 * esbuild 经 JS API 调用（0.28.x，pnpm 布局下 createRequire 可解析；.bin shim 在
 * Windows/pnpm 下不可靠，勿用）。客户端中间产物只在内存，不落盘。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(path.join(root, 'package.json'))
const esbuild = require('esbuild')

const CLIENT_ID = 'dsh-llm-retry-settings'

// 1) 宿主半边：ESM 自包含——运行环境是 junction 链接的插件包，没有完整依赖树
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: path.join(root, 'lib/index.js'),
  logLevel: 'info',
})

// 2) 客户端半边：浏览器 CJS，react / dsh-client-web-react 由页面 runtime 提供
const raw = esbuild
  .buildSync({
    entryPoints: [path.join(root, 'src/client/index.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-web-react'],
    write: false,
    logLevel: 'info',
  })
  .outputFiles[0].text

// 包上 __ModuleLoader__ 壳（web 端插件加载约定）：factory 内自建 module/exports，
// 返回 module.exports
const wrapped =
  `window.__ModuleLoader__.load({id: ${JSON.stringify(CLIENT_ID)},factory: (require) => {` +
  `var module = { exports: {} };var exports = module.exports;` +
  '\n' +
  raw.trimEnd() +
  '\nreturn module.exports;}\n});\n'
fs.writeFileSync(path.join(root, 'lib/client.js'), wrapped)

console.log('build done: lib/index.js + lib/client.js')
