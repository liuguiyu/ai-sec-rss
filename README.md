# AI · SEC RSS — 免费 RSS 精选聚合

一个发布到公网的 Web 应用：聚合 **AI（人工智能）** 与 **Security（网络安全）** 两个大类的 **Top 10 免费 RSS 源**，
按时间倒序去重展示，支持搜索、按来源筛选、深浅配色区分两类，5 分钟自动刷新。

在线地址：
- Vercel：https://ai-sec-rss.vercel.app
- Render（备用，未部署）：https://<你的项目名>.onrender.com

## 特性

- 🤖 AI / 🛡️ Security 双分类，每类 10 个免费源（见 `feeds.json`）
- 跨源去重、按发布时间倒序，显示来源徽章 + 相对时间 + 摘要
- 客户端搜索过滤、按来源筛选、24 小时内内容标「新」
- 每 5 分钟内存缓存聚合结果；单源失败不影响整体，并显示“x/10 源正常”
- 服务端聚合，不受浏览器 CORS 限制；后端 Node.js + Express（rss-parser）

## 免费 RSS 源

**AI：** OpenAI News · Google DeepMind · The Verge AI · TechCrunch AI · VentureBeat AI · MIT Tech Review AI · IEEE Spectrum AI · MarkTechPost · arXiv cs.AI · Unite.AI

**Security：** Krebs on Security · The Hacker News · BleepingComputer · Schneier · Threatpost · Dark Reading · Unit 42 · CISA Advisories · WeLiveSecurity · SANS ISC

> 说明：个别源（如 arXiv、BleepingComputer、The Hacker News）在某些地区/网络可能被限流或超时，代码会自动跳过并提示，不影响其它源；部署在海外平台后一般全部可用。所有源均免费。

## 本地运行

需要 Node.js 18+。

```bash
npm install
npm start          # 默认 http://localhost:3000
```

## 部署到 Vercel（推荐）

1. 把本目录推到一个 GitHub/GitLab 仓库（公开或私有均可）；
2. 打开 https://vercel.com/new → Import 该仓库；
3. Framework Preset 选 **Other**（不要选 Next.js），构建命令留空，安装命令自动 `npm install`；
4. 点 Deploy，一两分钟后得到 `https://xxx.vercel.app`。

说明：Vercel 会自动把根目录 `index.html`、`static/` 作为静态资源，把 `api/feeds.js` 作为 Serverless 函数（`/api/feeds`）。`vercel.json` 已配置缓存头。
本地可先用 CLI 预览：`npx vercel dev`。

## 部署到 Render

1. 把本目录推到 GitHub；
2. 打开 https://render.com → New → Web Service → 选该仓库；
3. Runtime 选 **Node**；Build Command：`npm install`；Start Command：`node server.js`；
4. 选 Free 实例，Create。得到 `https://xxx.onrender.com`。

仓库里已附 `render.yaml`（Blueprint），也可以在 Render 里用 “Blueprint” 一键部署。

## 自定义源

编辑 `feeds.json`：`ai` 与 `security` 各是一个数组，每项 `{ "name": 显示名, "url": RSS地址, "home": 官网 }`。
改完重启或重新部署即可，不需要改代码。也可以直接请求 `/api/feeds/list` 查看当前配置。

## API

- `GET /api/feeds?cat=ai` — AI 聚合
- `GET /api/feeds?cat=security` — Security 聚合
- `GET /api/feeds?cat=all` — 合并两类
- 返回 `{ ok, category, updatedAt, sourcesTotal, sourcesOk, sources:[{name,ok,error,count}], items:[{title,link,pubDate,summary,source,feedUrl,home}] }`

## 目录结构

```
ai-sec-rss/
  index.html        前端入口（Vercel 静态页根）
  static/           style.css / app.js
  lib/aggregator.js 抓取 + 解析 + 去重 + 排序 + 缓存
  api/feeds.js      Vercel Serverless 函数
  server.js         Render/本地 Express 服务
  feeds.json        免费 RSS 源配置
  package.json
  vercel.json / render.yaml / .gitignore
```

> 免责声明：内容版权归各来源所有，本应用仅聚合展示并跳转原文。
