/**
 * dsh-llm-retry-settings — 宿主半边
 *
 * 1. 注册设置命名空间 `dsh-llm-retry`（schema 校验 + 持久化 + live 同步），
 *    客户端卡片绑定同一命名空间读写。
 * 2. 用 prepend 在 `agent/request-error` 监听器链最前端改写 retryPolicy：
 *    官方 @deepseek-ai/dsh-llm-retry 的 recover 会拿到覆盖后的策略——
 *    保留 provider 的 mode/retryableCodes，仅覆盖次数与退避时间。
 *    enabled=false（默认）时完全旁路，不改任何东西。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-llm-retry-settings";
export declare const inject: string[];
export interface Config {
    enabled: boolean;
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    jitterRatio: number;
    /** 补充到重试码列表的额外 code,与 provider 默认值合并(不去重覆盖)。空数组=不补充。 */
    retryableCodes: string[];
}
export declare const Config: any;
export declare function apply(ctx: Context, config: Partial<Config> | undefined): void;
