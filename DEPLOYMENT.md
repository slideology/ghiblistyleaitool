# GitHub Actions 自动部署配置指南

## 配置步骤

### 1. 设置GitHub Secrets

在GitHub仓库中，转到 Settings > Secrets and variables > Actions，添加以下Secrets：

#### 必需的Secrets：
- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID

#### 应用环境变量Secrets：
- `SESSION_SECRET`: 会话密钥
- `CDN_URL`: R2 CDN URL
- `DOMAIN`: 部署域名
- `GOOGLE_CLIENT_ID`: Google OAuth客户端ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth客户端密钥
- `KIEAI_APIKEY`: KIE AI API密钥
- `CREEM_KEY`: Creem支付系统密钥
- `CREEM_TEST_KEY`: Creem测试密钥
- `CREEM_WEBHOOK_SECRET`: Webhook密钥
- `GOOGLE_ANALYTICS_ID`: Google Analytics ID
- `GOOGLE_ADS_ID`: Google AdSense ID

#### 数据库和存储ID：
- `D1_DATABASE_ID`: D1数据库ID
- `KV_NAMESPACE_ID`: KV命名空间ID
- `R2_BUCKET_NAME`: R2存储桶名称

### 2. 获取Cloudflare配置信息

#### 获取API Token：
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 转到 "My Profile" > "API Tokens"
3. 创建一个Custom token，包含以下权限：
   - Account: Cloudflare Workers:Edit
   - Zone: Zone:Read
   - Zone: Zone Settings:Read

#### 获取Account ID：
在Cloudflare Dashboard右侧边栏可以看到Account ID

#### 获取数据库和存储ID：
- D1数据库ID：在Workers & Pages > D1中找到数据库
- KV命名空间ID：在Workers & Pages > KV中找到命名空间
- R2存储桶名称：在R2 Object Storage中找到存储桶

### 3. 本地开发设置

1. 复制 `.env.example` 到 `.env`
2. 填入对应的环境变量值
3. 运行 `pnpm install` 安装依赖
4. 运行 `pnpm run dev` 启动开发服务器

### 4. 手动部署

如果需要手动部署：
```bash
pnpm run build
wrangler deploy
```

### 5. 自动部署触发

推送到main分支将自动触发部署：
```bash
git add .
git commit -m "你的提交信息"
git push origin main
```

## 故障排除

### 常见问题：

1. **API Token权限不足**：确保Token具有正确的权限
2. **环境变量未设置**：检查GitHub Secrets是否正确配置
3. **数据库迁移失败**：确保D1数据库已创建并配置正确
4. **构建失败**：检查依赖是否正确安装

### 检查部署状态：

在GitHub仓库的Actions标签页可以查看部署状态和日志。