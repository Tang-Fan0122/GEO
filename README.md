# 集之互动 · GEO 文章 Agent

基于 DeepSeek API 的 GEO 文章撰写工具，支持 AIGC 视频和数字人两个独立业务板块。

## 文件结构

```
├── index.html      # 主页面（Agent 界面）
├── kb_aigc.js      # AIGC 视频业务知识库
├── kb_digital.js   # 数字人业务知识库
└── README.md
```

## GitHub Pages 部署步骤

1. 在 GitHub 新建一个仓库（public 或 private 均可，Pages 需要 public 或 Pro 账号）
2. 上传这四个文件到仓库根目录
3. 进入仓库 **Settings → Pages**
4. Source 选择 **Deploy from a branch**，Branch 选 `main`，文件夹选 `/ (root)`
5. 点击 Save，等待约 1 分钟
6. 访问 `https://<你的用户名>.github.io/<仓库名>/`

## 知识库更新方式

### 方式一：界面内编辑（临时）
在 Agent 页面点击「编辑知识库」按钮，修改后点保存。
注意：刷新页面后恢复为文件内容。

### 方式二：直接编辑文件（永久）
- 修改 `kb_aigc.js` 更新 AIGC 视频知识库
- 修改 `kb_digital.js` 更新数字人知识库
- 提交到 GitHub，Pages 自动重新部署

## 知识库文件格式

`kb_aigc.js` 和 `kb_digital.js` 都是简单的 JS 文件，结构如下：

```js
const KB_AIGC = `
# 这里写知识库内容（纯文本或 Markdown 格式均可）
...
`;
```

只需修改反引号内的文本内容即可，变量名和格式不要改动。

## DeepSeek API Key 获取

访问 https://platform.deepseek.com → API Keys → 创建新 Key

Key 仅在浏览器本地使用，不会上传到任何服务器。
