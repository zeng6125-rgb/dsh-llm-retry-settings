/**
 * 最小环境类型声明：打包版 DSH 的 @deepseek-ai/* 包不带 .d.ts，
 * 这里只声明本插件实际用到的表面，编译期自洽、运行期原样解析。
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    /** 注册事件/waterfall 监听器；随所属 fiber 自动卸载。prepend 插入监听器链首。 */
    on(name: string, listener: (...args: any[]) => any, options?: { prepend?: boolean; global?: boolean }): () => boolean
    /** 注册 fiber 级 effect（卸载时执行清理）。 */
    effect(fn: () => (() => void) | void, label?: string): () => void
    /** 按需注入服务后再执行回调。 */
    inject(services: string[], callback: (ctx: Context) => void): void
    logger: {
      info(message: string, ...args: unknown[]): void
      warn(message: string, ...args: unknown[]): void
      error(message: string, ...args: unknown[]): void
    }
    [key: string]: any
  }
}

declare module '@deepseek-ai/schemastery' {
  interface Schema<T = unknown> {
    default(value: T): Schema<T>
    [key: string]: any
  }
  const z: {
    object(shape: Record<string, Schema | any>): any
    boolean(): Schema<boolean>
    number(): Schema<number>
    string(): Schema<string>
  }
  export default z
}

declare module '@deepseek-ai/dsh-settings' {
  export type SettingsNamespace = string & { readonly __settingsNamespace: true }
  export function settingsNamespace(value: string): SettingsNamespace
  export function installSettingsSection(
    ctx: any,
    ns: SettingsNamespace,
    schema: any,
    entry: any,
    hooks: {
      setSource: (fn: () => any) => void
      onChange: () => void
      validate?: (value: any) => void
    },
  ): void
}
