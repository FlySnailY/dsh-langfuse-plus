# Contributing

感谢你愿意为 dsh-langfuse-plus 贡献！以下是开发与发布的约定。

## 开发

```sh
pnpm install          # 安装依赖（严格按 pnpm-lock.yaml）
pnpm check            # 一键全量检查：test + typecheck + build:client
```

- **测试**：`pnpm test`（mapping 层纯函数快照测试，不依赖网络/OTel/Langfuse）
- **类型检查**：`pnpm typecheck`
- **client 产物**：修改 `client/index.tsx` 后必须 `pnpm build:client` 并提交 `lib/client.js`（CI 会校验两者一致）

## 提交约定

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:` / `fix:` / `docs:` / `test:` / `ci:` / `chore:` / `refactor:`
- 每个提交聚焦一件事；测试与代码同提交

## 发布流程

1. 确认改动已提交、CI 全绿
2. 更新 `CHANGELOG.md`：在顶部新增 `## <版本> (YYYY-MM-DD)` 条目（内容与 package.json version 一致，CI 会校验）
3. 升级版本 + 打 tag：

   ```sh
   npm version patch   # 或 minor / major
   git push --follow-tags
   ```

4. 发布 npm：

   ```sh
   unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
   npm publish
   ```

5. 在 GitHub 创建 Release（tag 选刚打的版本），notes 结构：亮点 / 变更 / 安装 / 链接

## 兼容性

- 需 DSH ≥ `0.1.0-rc.6`、Langfuse ≥ v4
- seam 依赖锁定与已验证宿主一致的版本；DSH 发新版时先 diff seam 接口再决定是否升级
