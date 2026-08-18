# Security

dsh-langfuse-plus 只把会话事件发送到 `DSH_LANGFUSE_BASE_URL` 对应的 Langfuse 实例，不发送任何数据到其它端点。

- **数据流向**：telemetry record 仅经本插件转成 trace 上报 Langfuse；未挂脱敏规则时数据**原样透传**（脱敏需自行挂 `session-telemetry/record` 监听器）
- **凭据**：`DSH_LANGFUSE_PUBLIC_KEY` / `DSH_LANGFUSE_SECRET_KEY` 仅通过环境变量注入，以 Basic Auth 走 HTTPS 传输，**不本地落盘**
- **上报漏洞**：请通过 GitHub Issues（https://github.com/FlySnailY/dsh-langfuse-plus/issues）联系维护者
