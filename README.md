# Mindspace · 思维空间

集体脑暴的空间关系网络。问题不是列表，是一张会长大的网：每次投稿由 **Jev** 判断它与既有问题的关系强度，力导布局把强关系拉近、弱关系推远；**ds4.1** 每隔一阵回看并维护这张网。

线上：<https://mindspace.sligenai.cn>

## 两个角色

| 角色 | 能做什么 |
| --- | --- |
| 脑暴者 | 输入问题 / 想法 / 顾虑；看全网形状、邻居、聚类；按人、标签、属性检索 |
| 收集者 | 脑暴者的全部能力 + 发布方向、生成邀请链接、看后台数据、导出、派发任务、验收结果、签发 Agent Key |

空间创建者（owner）还能调整成员角色。Agent Key 天然带收集者权限。

## 核心机制

1. **落点**：投稿 → 本地字面相似度粗筛 14 个候选 → `typesafe/jev-router` 判定语义强度（35 分以下不连边）+ 生成标签 / 领域 / 类型 / 一句话概括。
2. **布局**：新节点落在强邻居重心，局部力导松弛。弹簧静止长度 `100 - strength × 0.8`，所以关联越强距离越近。
3. **聚类**：带权标签传播（边权 ≥ 30），≥3 个节点才单独成簇，Jev 给簇命名。
4. **审校**：`deepseek/deepseek-v4.1-flash` 每 30 分钟（`AUDIT_INTERVAL_MIN`）处理最近变化的节点：合并重复、删除低强度错边、补漏边、纠正标签、重算聚类。应用策略保守：只删 <60 的边，只加 ≥60 的边。
5. **实时**：SSE 推 `node.created` / `audit.completed` / `task.updated`。

## 技术栈

Next.js 16（App Router，webpack 构建）+ React 19 + PostgreSQL 16 + three.js。零 ORM，`pg` + 一份幂等 SQL。

> 注意：项目路径含中文时 Turbopack 会 panic，所以构建脚本固定 `next build --webpack`。

## 本地开发

```bash
npm install
cp .env.example .env      # 填 DATABASE_URL / AUTH_SECRET / OPENROUTER_API_KEY
npm run migrate
npm run dev               # http://localhost:3020
```

没有短信通道时设 `ALLOW_DEV_CODE=1`，任意手机号 + `DEV_LOGIN_CODE`（默认 888888）可登录。

## 部署（121.43.51.197）

服务器无 Docker，走 systemd + nginx：

```bash
# 服务器
mkdir -p /home/donxu/apps/mindspace
# 上传代码、放好 .env
cd /home/donxu/apps/mindspace && bash deploy/deploy.sh
sudo cp deploy/mindspace.service /etc/systemd/system/mindspace.service
sudo systemctl daemon-reload && sudo systemctl enable --now mindspace
sudo cp deploy/nginx-mindspace.conf /etc/nginx/sites-available/mindspace.sligenai.cn
sudo ln -sf ../sites-available/mindspace.sligenai.cn /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mindspace.sligenai.cn
```

监听 `127.0.0.1:3020`，nginx 反代，SSE 单独关闭 buffering。

## Agent 接入

生成 Agent Key（后台 → Agent Key），然后：

```bash
curl -fsSL https://mindspace.sligenai.cn/api/cli -o mindspace.mjs
export MINDSPACE_URL=https://mindspace.sligenai.cn
export MINDSPACE_KEY=ms_live_...
node mindspace.mjs tasks --status open
node mindspace.mjs take <taskId> --agent claude-3
node mindspace.mjs resolve <taskId> --file result.md
node mindspace.mjs worker --agent claude-worker --exec "claude -p {prompt}"
```

完整契约见 <https://mindspace.sligenai.cn/docs> 或 `cli/mindspace.mjs` 顶部注释。

## 项目结构

```
src/app/            页面与 API 路由
src/components/     3D 画布、空间视图、后台、列表
src/lib/            analyze / graph / audit / tasks / auth / sms / llm
db/schema.sql       幂等 schema（migrate 脚本按序执行）
cli/mindspace.mjs   零依赖 CLI（也可通过 /api/cli 下载）
deploy/             systemd unit / nginx site / deploy.sh
```

## 安全

- 短信验证码 10 分钟有效、5 次尝试上限、60s 重发、按 IP/手机号限流。
- Agent Key 只存 sha256(secret + key)，创建后仅显示一次，可撤销。
- 敏感配置全部走 `.env`，不提交仓库。
- **验收模式**：`ALLOW_DEV_CODE=1` 时存在固定验证码后门，上线验收完成后必须改成 `0` 并重启。
