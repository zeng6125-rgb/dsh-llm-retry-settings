// Loader 兼容垫片：cordis-plugin-loader 的 loader.create({name}) 按
// "<package>/index.js" 约定解析入口（报错 Cannot find package '...\index.js'，
// 不读 package.json main/exports）。真正实现在 ./lib/index.js，这里透明转发。
export * from './lib/index.js'
