# dsh-langfuse-plus

DSH（DeepSeek Harness）的 Langfuse 可观测性插件：会话轮次映射为 Langfuse trace 树（同会话经 session id 聚合），提供 Prompt 版本管理与评测能力。

- 零 DSH 源码修改，基于官方 telemetry seam
- turn/step/tool/generation/event 全映射，含 token 用量
- system prompt 与 Langfuse 版本化双向同步
- `/feedback` 自动上报 score、`/dataset` 一键建评测数据集
- DSH 侧栏一键跳转 Langfuse

## 安装

```sh
export DSH_LANGFUSE_PUBLIC_KEY=lf_pk_...
export DSH_LANGFUSE_SECRET_KEY=lf_sk_...

# npm 安装
dsh plugin --profile web add dsh-langfuse-plus

# 或本地目录安装（开发）
dsh plugin --profile web add ./dsh-langfuse-plus
```

配置项（实例地址 / 环境标签 / Prompt 同步等）见 [.env.example](.env.example)，均可用环境变量覆盖。自托管 Langfuse 编排见 [docker-compose.langfuse.yml](docker-compose.langfuse.yml)。

需 DSH ≥ `0.1.0-rc.6`（rc.8 已验证兼容）与 Langfuse ≥ v4。

## 限制

- 未挂脱敏规则时，会话数据**原样透传**至 Langfuse（脱敏需自行挂 `session-telemetry/record` 监听器）
- 成本由 Langfuse 按模型价格表计算（Settings → Model Definitions 配置 DeepSeek 价格后显示），插件不上报价格
- 进程被 SIGKILL（未走 shutdown 兜底）时，内存中最后一批 span 可能丢失

## 许可证

[MIT](LICENSE)
