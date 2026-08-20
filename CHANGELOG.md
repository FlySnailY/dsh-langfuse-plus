# Changelog

## 0.1.1 (2026-08-20)

- seam 依赖升级至 `0.1.0-rc.8`（与 DSH rc.8 宿主对齐，接口零差异，tarball 逐文件 diff 确认）
- 兼容性验证：DSH `0.1.0-rc.8` 实测通过（本地升级 rc.7→rc.8 后，插件 23/23 测试、typecheck、启动加载 `connectivity OK`、页面 200 全通过）

## 0.1.0 (2026-08-18)

Initial release:

- 会话事件全映射到 Langfuse trace（turn/step/tool/generation/event + token 用量），基于官方 telemetry seam，零 DSH 源码修改
- Prompt 双向桥：system prompt 与 Langfuse 版本化双向同步（15s TTL 缓存 + in-flight 去重）
- `/dataset` 命令：一键把最近一轮 trace 加入 dataset（sourceTraceId 关联）
- feedback/record → `user_feedback` score（确定性幂等 id，重放不重复）
- DSH 侧栏 Langfuse 入口按钮（构建期注入跳转地址）
- 自带自托管编排 `docker-compose.langfuse.yml`
- 需 DSH ≥ `0.1.0-rc.6`，Langfuse ≥ v4
- 兼容性验证：DSH `0.1.0-rc.7` 实测通过（本地升级 rc.5→rc.7 后全通过）
