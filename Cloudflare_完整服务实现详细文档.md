# Cloudflare 完整服务实现详细文档

## 📋 概述

本文档详细介绍了AI发型变换应用中使用的三个核心Cloudflare服务：
- **D1 数据库**：全球分布式SQL数据库，用于存储结构化数据
- **R2 对象存储**：兼容S3的对象存储服务，用于文件存储
- **KV 键值存储**：全球分布式键值存储，用于缓存和会话管理

这三个服务共同构成了应用的完整数据存储架构，提供高性能、低延迟的全球化服务。

## 🏗️ 整体架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │     KV      │  │     D1      │  │     R2      │        │
│  │ 键值存储     │  │  SQL数据库   │  │  对象存储    │        │
│  │             │  │             │  │             │        │
│  │ • 会话管理   │  │ • 用户数据   │  │ • 图片文件   │        │
│  │ • 缓存数据   │  │ • 订单记录   │  │ • AI结果    │        │
│  │ • 配置信息   │  │ • 任务状态   │  │ • 静态资源   │        │
│  │ • 临时数据   │  │ • 积分记录   │  │ • 备份文件   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ React Router App │
                    │  (Workers 运行)  │
                    └─────────────────┘
```

## 🗄️ D1 数据库详细实现

### 核心特点

- **全球分布**：数据在Cloudflare全球网络中复制
- **SQL兼容**：支持标准SQL语法和SQLite功能
- **自动扩展**：根据负载自动扩展容量
- **低延迟**：边缘读取延迟通常 < 10ms
- **ACID事务**：支持完整的事务特性

### 配置与绑定

**文件位置**: `wrangler.jsonc`

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ai-hairstyle",
      "database_id": "your_d1_database_id",
      "migrations_dir": "./app/.server/drizzle/migrations"
    }
  ]
}
```

### 数据库架构设计

#### 1. 用户管理模块

**用户表 (users)**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  credits INTEGER DEFAULT 3,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);
```

**用户认证表 (user_auth)**
```sql
CREATE TABLE user_auth (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'google', 'github', etc.
  openid TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_user_auth_provider_openid ON user_auth(provider, openid);
CREATE INDEX idx_user_auth_user_id ON user_auth(user_id);
```

**登录日志表 (signin_logs)**
```sql
CREATE TABLE signin_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_signin_logs_user_id ON signin_logs(user_id);
CREATE INDEX idx_signin_logs_created_at ON signin_logs(created_at);
```

#### 2. 订单与支付模块

**订单表 (orders)**
```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL, -- 金额（分）
  currency TEXT DEFAULT 'CNY',
  status TEXT DEFAULT 'pending', -- pending, paid, processing, completed, refunding, refunded, cancelled, expired
  payment_provider TEXT DEFAULT 'creem',
  payment_id TEXT, -- 第三方支付ID
  payment_url TEXT, -- 支付链接
  credits INTEGER NOT NULL, -- 购买的积分数量
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_id ON orders(payment_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

#### 3. 积分管理模块

**积分记录表 (credit_records)**
```sql
CREATE TABLE credit_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL, -- 积分数量（正数为增加，负数为消费）
  type TEXT NOT NULL, -- 'purchase', 'gift', 'consumption', 'refund'
  entity_type TEXT, -- 关联实体类型：'order', 'task', 'admin'
  entity_id TEXT, -- 关联实体ID
  expires_at INTEGER, -- 过期时间（可选）
  note TEXT, -- 备注
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_credit_records_user_id ON credit_records(user_id);
CREATE INDEX idx_credit_records_type ON credit_records(type);
CREATE INDEX idx_credit_records_entity ON credit_records(entity_type, entity_id);
CREATE INDEX idx_credit_records_expires_at ON credit_records(expires_at);
```

**积分消耗表 (credit_consumptions)**
```sql
CREATE TABLE credit_consumptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL, -- 消耗的积分数量
  from_record_id TEXT NOT NULL, -- 消耗自哪笔积分记录
  entity_type TEXT NOT NULL, -- 消耗实体类型：'task'
  entity_id TEXT NOT NULL, -- 消耗实体ID
  reason TEXT, -- 消耗原因
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (from_record_id) REFERENCES credit_records(id) ON DELETE CASCADE
);

CREATE INDEX idx_credit_consumptions_user_id ON credit_consumptions(user_id);
CREATE INDEX idx_credit_consumptions_from_record ON credit_consumptions(from_record_id);
CREATE INDEX idx_credit_consumptions_entity ON credit_consumptions(entity_type, entity_id);
```

#### 4. AI任务管理模块

**AI任务表 (ai_tasks)**
```sql
CREATE TABLE ai_tasks (
  id TEXT PRIMARY KEY,
  task_no TEXT UNIQUE NOT NULL, -- 任务编号
  user_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  input_params TEXT NOT NULL, -- JSON格式的输入参数
  estimated_start_at INTEGER, -- 预计开始时间
  result_urls TEXT, -- JSON格式的结果URL数组
  failure_reason TEXT, -- 失败原因
  external_provider TEXT, -- 外部提供方：'kie_4o', 'kie_kontext'
  external_task_id TEXT, -- 外部任务ID
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_ai_tasks_task_no ON ai_tasks(task_no);
CREATE INDEX idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX idx_ai_tasks_external_task_id ON ai_tasks(external_task_id);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(created_at);
```

#### 5. 订阅管理模块

**订阅表 (subscriptions)**
```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_type TEXT NOT NULL, -- 'basic', 'pro', 'premium'
  status TEXT DEFAULT 'active', -- active, cancelled, expired
  billing_cycle TEXT DEFAULT 'monthly', -- monthly, yearly
  third_party_subscription_id TEXT, -- 第三方平台订阅ID
  enabled_at INTEGER,
  expires_at INTEGER,
  next_billing_at INTEGER,
  cancelled_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_expires_at ON subscriptions(expires_at);
```

### Drizzle ORM 实现

**文件位置**: `app/.server/drizzle/schema.ts`

```typescript
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// 用户表
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    picture: text("picture"),
    credits: integer("credits").default(3),
    createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    emailIdx: index("idx_users_email").on(table.email),
    createdAtIdx: index("idx_users_created_at").on(table.createdAt),
  })
);

// AI任务表
export const aiTasks = sqliteTable(
  "ai_tasks",
  {
    id: text("id").primaryKey(),
    taskNo: text("task_no").notNull().unique(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).default("pending"),
    inputParams: text("input_params").notNull(),
    estimatedStartAt: integer("estimated_start_at"),
    resultUrls: text("result_urls"),
    failureReason: text("failure_reason"),
    externalProvider: text("external_provider", { enum: ["kie_4o", "kie_kontext"] }),
    externalTaskId: text("external_task_id"),
    createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    taskNoIdx: uniqueIndex("idx_ai_tasks_task_no").on(table.taskNo),
    userIdIdx: index("idx_ai_tasks_user_id").on(table.userId),
    statusIdx: index("idx_ai_tasks_status").on(table.status),
    externalTaskIdIdx: index("idx_ai_tasks_external_task_id").on(table.externalTaskId),
    createdAtIdx: index("idx_ai_tasks_created_at").on(table.createdAt),
  })
);

// 关系定义
export const usersRelations = relations(users, ({ many }) => ({
  userAuth: many(userAuth),
  signinLogs: many(signinLogs),
  orders: many(orders),
  creditRecords: many(creditRecords),
  creditConsumptions: many(creditConsumptions),
  subscriptions: many(subscriptions),
  aiTasks: many(aiTasks),
}));

export const aiTasksRelations = relations(aiTasks, ({ one }) => ({
  user: one(users, {
    fields: [aiTasks.userId],
    references: [users.id],
  }),
}));

// 类型定义
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AiTask = typeof aiTasks.$inferSelect;
export type NewAiTask = typeof aiTasks.$inferInsert;
```

### 数据库操作服务

**文件位置**: `app/.server/services/database.ts`

```typescript
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import * as schema from "~/.server/drizzle/schema";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * 数据库服务类
 * 提供统一的数据库操作接口
 */
export class DatabaseService {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 用户相关操作
   */
  async createUser(userData: schema.NewUser): Promise<schema.User> {
    const [user] = await this.db.insert(schema.users).values(userData).returning();
    return user;
  }

  async getUserById(id: string): Promise<schema.User | null> {
    const user = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    return user || null;
  }

  async getUserByEmail(email: string): Promise<schema.User | null> {
    const user = await this.db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    return user || null;
  }

  async updateUserCredits(userId: string, credits: number): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ 
        credits, 
        updatedAt: sql`(strftime('%s', 'now'))` 
      })
      .where(eq(schema.users.id, userId));
  }

  /**
   * AI任务相关操作
   */
  async createAiTask(taskData: schema.NewAiTask): Promise<schema.AiTask> {
    const [task] = await this.db.insert(schema.aiTasks).values(taskData).returning();
    return task;
  }

  async getAiTaskById(id: string): Promise<schema.AiTask | null> {
    const task = await this.db.select().from(schema.aiTasks).where(eq(schema.aiTasks.id, id)).get();
    return task || null;
  }

  async getAiTaskByTaskNo(taskNo: string): Promise<schema.AiTask | null> {
    const task = await this.db.select().from(schema.aiTasks).where(eq(schema.aiTasks.taskNo, taskNo)).get();
    return task || null;
  }

  async updateAiTaskStatus(
    id: string, 
    status: "pending" | "processing" | "completed" | "failed",
    updates: Partial<Pick<schema.AiTask, "resultUrls" | "failureReason" | "externalTaskId">>
  ): Promise<void> {
    await this.db
      .update(schema.aiTasks)
      .set({ 
        status, 
        ...updates,
        updatedAt: sql`(strftime('%s', 'now'))` 
      })
      .where(eq(schema.aiTasks.id, id));
  }

  async getUserAiTasks(userId: string, limit = 20, offset = 0): Promise<schema.AiTask[]> {
    return await this.db
      .select()
      .from(schema.aiTasks)
      .where(eq(schema.aiTasks.userId, userId))
      .orderBy(desc(schema.aiTasks.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * 积分相关操作
   */
  async addCreditRecord(recordData: schema.NewCreditRecord): Promise<schema.CreditRecord> {
    const [record] = await this.db.insert(schema.creditRecords).values(recordData).returning();
    return record;
  }

  async getUserCreditBalance(userId: string): Promise<number> {
    const result = await this.db
      .select({ total: sql<number>`sum(amount)` })
      .from(schema.creditRecords)
      .where(
        and(
          eq(schema.creditRecords.userId, userId),
          // 只计算未过期的积分
          sql`(expires_at IS NULL OR expires_at > strftime('%s', 'now'))`
        )
      )
      .get();
    
    return result?.total || 0;
  }

  /**
   * 统计相关操作
   */
  async getUserStats(userId: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalCreditsUsed: number;
  }> {
    const [taskStats, creditStats] = await Promise.all([
      this.db
        .select({
          total: sql<number>`count(*)`,
          completed: sql<number>`sum(case when status = 'completed' then 1 else 0 end)`,
          failed: sql<number>`sum(case when status = 'failed' then 1 else 0 end)`,
        })
        .from(schema.aiTasks)
        .where(eq(schema.aiTasks.userId, userId))
        .get(),
      
      this.db
        .select({ total: sql<number>`sum(abs(amount))` })
        .from(schema.creditRecords)
        .where(
          and(
            eq(schema.creditRecords.userId, userId),
            eq(schema.creditRecords.type, "consumption")
          )
        )
        .get()
    ]);

    return {
      totalTasks: taskStats?.total || 0,
      completedTasks: taskStats?.completed || 0,
      failedTasks: taskStats?.failed || 0,
      totalCreditsUsed: creditStats?.total || 0,
    };
  }
}
```

## 📦 R2 对象存储详细实现

### 核心特点

- **S3兼容**：完全兼容Amazon S3 API
- **全球分布**：数据在全球边缘位置缓存
- **零出口费用**：从R2到互联网的数据传输免费
- **高性能**：低延迟的文件访问
- **无限扩展**：按需扩展存储容量

### 配置与绑定

**文件位置**: `wrangler.jsonc`

```json
{
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "ai-hairstyle"
    }
  ]
}
```

### 存储架构设计

```
ai-hairstyle (R2 Bucket)
├── cache/                    # 用户上传的原始文件缓存
│   ├── {userId}/
│   │   ├── {timestamp}_{filename}
│   │   └── ...
│   └── ...
├── result/                   # AI处理结果
│   ├── hairstyle/           # 发型变换结果
│   │   ├── {taskId}/
│   │   │   ├── result_1.jpg
│   │   │   ├── result_2.jpg
│   │   │   └── ...
│   │   └── ...
│   └── other/               # 其他AI处理结果
├── avatars/                 # 用户头像
│   ├── {userId}.jpg
│   └── ...
└── static/                  # 静态资源
    ├── templates/           # 发型模板
    ├── samples/             # 示例图片
    └── assets/              # 其他静态资源
```

### R2 存储服务实现

**文件位置**: `app/.server/services/r2-bucket.ts`

```typescript
import type { R2Bucket } from "@cloudflare/workers-types";

/**
 * R2存储服务类
 * 提供文件上传、下载、删除等操作
 */
export class R2StorageService {
  constructor(private r2: R2Bucket) {}

  /**
   * 上传文件到指定文件夹
   * @param files 文件数组
   * @param folder 目标文件夹，默认为 'cache'
   * @param userId 用户ID，用于创建用户专属目录
   * @returns 上传成功的文件信息数组
   */
  async uploadFiles(
    files: File[], 
    folder: string = "cache", 
    userId?: string
  ): Promise<Array<{ key: string; url: string; size: number }>> {
    const uploadPromises = files.map(async (file) => {
      // 生成唯一文件名
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileExtension = file.name.split('.').pop() || 'bin';
      const fileName = `${timestamp}_${randomSuffix}.${fileExtension}`;
      
      // 构建文件路径
      const key = userId 
        ? `${folder}/${userId}/${fileName}`
        : `${folder}/${fileName}`;
      
      // 上传文件
      await this.r2.put(key, file.stream(), {
        httpMetadata: {
          contentType: file.type || 'application/octet-stream',
          cacheControl: 'public, max-age=31536000', // 1年缓存
        },
        customMetadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          userId: userId || 'anonymous',
        },
      });
      
      return {
        key,
        url: `https://your-cdn-domain.com/${key}`,
        size: file.size,
      };
    });
    
    return await Promise.all(uploadPromises);
  }

  /**
   * 从外部URL下载文件并上传到R2
   * @param urls 外部文件URL数组
   * @param folder 目标文件夹类型
   * @param taskId 任务ID，用于创建任务专属目录
   * @returns 下载并上传成功的文件信息数组
   */
  async downloadFilesToBucket(
    urls: string[], 
    folder: "result" | "template" | "sample",
    taskId?: string
  ): Promise<Array<{ key: string; url: string; size: number }>> {
    const downloadPromises = urls.map(async (url, index) => {
      try {
        // 下载文件
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download file from ${url}: ${response.statusText}`);
        }
        
        // 获取文件信息
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const fileExtension = this.getFileExtensionFromContentType(contentType);
        const fileName = `result_${index + 1}.${fileExtension}`;
        
        // 构建存储路径
        let key: string;
        if (folder === "result" && taskId) {
          key = `result/hairstyle/${taskId}/${fileName}`;
        } else {
          key = `${folder}/${fileName}`;
        }
        
        // 上传到R2
        await this.r2.put(key, response.body, {
          httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=31536000',
          },
          customMetadata: {
            sourceUrl: url,
            downloadedAt: new Date().toISOString(),
            taskId: taskId || '',
          },
        });
        
        return {
          key,
          url: `https://your-cdn-domain.com/${key}`,
          size: parseInt(response.headers.get('content-length') || '0'),
        };
      } catch (error) {
        console.error(`Failed to download and upload file from ${url}:`, error);
        throw error;
      }
    });
    
    return await Promise.all(downloadPromises);
  }

  /**
   * 获取文件
   * @param key 文件键
   * @returns 文件对象或null
   */
  async getFile(key: string): Promise<R2Object | null> {
    return await this.r2.get(key);
  }

  /**
   * 删除文件
   * @param key 文件键
   */
  async deleteFile(key: string): Promise<void> {
    await this.r2.delete(key);
  }

  /**
   * 批量删除文件
   * @param keys 文件键数组
   */
  async deleteFiles(keys: string[]): Promise<void> {
    const deletePromises = keys.map(key => this.r2.delete(key));
    await Promise.all(deletePromises);
  }

  /**
   * 列出指定前缀的文件
   * @param prefix 文件前缀
   * @param limit 限制数量
   * @returns 文件列表
   */
  async listFiles(prefix: string, limit = 1000): Promise<R2Objects> {
    return await this.r2.list({ prefix, limit });
  }

  /**
   * 获取文件的预签名URL
   * @param key 文件键
   * @param expiresIn 过期时间（秒），默认1小时
   * @returns 预签名URL
   */
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    // 注意：R2的预签名URL需要通过S3兼容API实现
    // 这里简化处理，实际项目中需要使用AWS SDK
    return `https://your-cdn-domain.com/${key}?expires=${Date.now() + expiresIn * 1000}`;
  }

  /**
   * 清理过期的缓存文件
   * @param olderThanDays 清理多少天前的文件
   */
  async cleanupExpiredCache(olderThanDays = 7): Promise<number> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const cacheFiles = await this.listFiles('cache/');
    
    let deletedCount = 0;
    const deletePromises: Promise<void>[] = [];
    
    for (const file of cacheFiles.objects) {
      if (file.uploaded && file.uploaded.getTime() < cutoffTime) {
        deletePromises.push(this.deleteFile(file.key));
        deletedCount++;
      }
    }
    
    await Promise.all(deletePromises);
    return deletedCount;
  }

  /**
   * 根据Content-Type获取文件扩展名
   */
  private getFileExtensionFromContentType(contentType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'application/json': 'json',
    };
    
    return mimeToExt[contentType] || 'bin';
  }
}

/**
 * 文件上传工具函数
 * @param files 要上传的文件数组
 * @param r2 R2存储桶实例
 * @param folder 目标文件夹
 * @param userId 用户ID
 * @returns 上传结果
 */
export async function uploadFiles(
  files: File[], 
  r2: R2Bucket, 
  folder: string = "cache", 
  userId?: string
): Promise<Array<{ key: string; url: string; size: number }>> {
  const storageService = new R2StorageService(r2);
  return await storageService.uploadFiles(files, folder, userId);
}

/**
 * 下载外部文件到R2存储桶
 * @param urls 外部文件URL数组
 * @param r2 R2存储桶实例
 * @param folder 目标文件夹类型
 * @param taskId 任务ID
 * @returns 下载结果
 */
export async function downloadFilesToBucket(
  urls: string[], 
  r2: R2Bucket, 
  folder: "result" | "template" | "sample",
  taskId?: string
): Promise<Array<{ key: string; url: string; size: number }>> {
  const storageService = new R2StorageService(r2);
  return await storageService.downloadFilesToBucket(urls, folder, taskId);
}

/**
 * 获取文件
 * @param key 文件键
 * @param r2 R2存储桶实例
 * @returns 文件对象
 */
export async function getFile(key: string, r2: R2Bucket): Promise<R2Object | null> {
  const storageService = new R2StorageService(r2);
  return await storageService.getFile(key);
}
```

## 🔑 KV 键值存储详细实现

### 核心特点

- **全球分布**：数据在Cloudflare的全球边缘网络中复制
- **最终一致性**：写入操作在全球范围内最终一致
- **高可用性**：99.9%的可用性保证
- **低延迟**：边缘读取延迟通常 < 50ms
- **大容量**：单个命名空间最多支持1000万个键

### 配置与绑定

**文件位置**: `wrangler.jsonc`

```json
{
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your_kv_namespace_id"
    }
  ]
}
```

### 数据分类与使用场景

#### 1. 会话管理

**文件位置**: `app/.server/libs/session.ts`

```typescript
import { env } from "cloudflare:workers";
import { createCookie } from "react-router";
import { createWorkersKVSessionStorage } from "@react-router/cloudflare";
import type { User } from "~/.server/libs/db";

// 会话数据类型定义
type SessionData = {
  user: User;
};

/**
 * 创建会话Cookie配置
 */
export function cookieWrapper() {
  return createCookie("__session", {
    secrets: [env.SESSION_SECRET],
    path: "/",
    sameSite: "strict",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30天过期
  });
}

/**
 * 创建KV会话存储
 */
export function sessionWrapper() {
  const sessionCookie = cookieWrapper();
  const sessionStorage = createWorkersKVSessionStorage<SessionData>({
    kv: env.KV,
    cookie: sessionCookie,
  });

  return sessionStorage;
}

/**
 * 会话处理器
 */
export const getSessionHandler = async (request: Request) => {
  const action = sessionWrapper();
  const session = await action.getSession(request.headers.get("Cookie"));

  return [session, action] as const;
};
```

#### 2. 缓存服务

**文件位置**: `app/.server/services/kv-cache.ts`

```typescript
import type { KVNamespace } from "@cloudflare/workers-types";

/**
 * KV缓存服务类
 * 提供统一的缓存操作接口
 */
export class KVCacheService {
  constructor(private kv: KVNamespace) {}

  /**
   * 缓存用户信息
   * @param userId 用户ID
   * @param userData 用户数据
   * @param ttl 过期时间（秒），默认1小时
   */
  async cacheUser(userId: string, userData: any, ttl = 3600): Promise<void> {
    const key = `user:${userId}`;
    const value = {
      data: userData,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
    };
    
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttl
    });
  }

  /**
   * 获取缓存的用户信息
   * @param userId 用户ID
   * @returns 用户数据或null
   */
  async getCachedUser(userId: string): Promise<any | null> {
    const key = `user:${userId}`;
    const cached = await this.kv.get(key, "json");
    
    if (!cached) return null;
    
    return cached.data;
  }

  /**
   * 缓存AI任务结果
   * @param taskId 任务ID
   * @param result 任务结果
   * @param ttl 过期时间（秒），默认2小时
   */
  async cacheTaskResult(taskId: string, result: any, ttl = 7200): Promise<void> {
    const key = `task:result:${taskId}`;
    await this.kv.put(key, JSON.stringify(result), {
      expirationTtl: ttl
    });
  }

  /**
   * 获取缓存的任务结果
   * @param taskId 任务ID
   * @returns 任务结果或null
   */
  async getCachedTaskResult(taskId: string): Promise<any | null> {
    const key = `task:result:${taskId}`;
    return await this.kv.get(key, "json");
  }

  /**
   * 缓存应用配置
   * @param configKey 配置键
   * @param configValue 配置值
   * @param ttl 过期时间（秒），默认24小时
   */
  async cacheConfig(configKey: string, configValue: any, ttl = 86400): Promise<void> {
    const key = `config:${configKey}`;
    await this.kv.put(key, JSON.stringify(configValue), {
      expirationTtl: ttl
    });
  }

  /**
   * 获取缓存的配置
   * @param configKey 配置键
   * @returns 配置值或null
   */
  async getCachedConfig(configKey: string): Promise<any | null> {
    const key = `config:${configKey}`;
    return await this.kv.get(key, "json");
  }

  /**
   * 限流计数器
   * @param identifier 标识符（如用户ID、IP地址）
   * @param window 时间窗口（秒），默认1小时
   * @param limit 限制次数，默认100次
   * @returns 是否允许访问和剩余次数
   */
  async incrementRateLimit(
    identifier: string, 
    window = 3600, 
    limit = 100
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const windowStart = Math.floor(Date.now() / (window * 1000));
    const key = `rate:${identifier}:${windowStart}`;
    
    const current = await this.kv.get(key);
    const count = current ? parseInt(current) + 1 : 1;
    
    await this.kv.put(key, count.toString(), {
      expirationTtl: window
    });
    
    const resetTime = (windowStart + 1) * window * 1000;
    
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetTime
    };
  }

  /**
   * 存储临时令牌
   * @param tokenType 令牌类型
   * @param token 令牌值
   * @param data 关联数据
   * @param ttl 过期时间（秒），默认15分钟
   */
  async storeToken(
    tokenType: string, 
    token: string, 
    data: any, 
    ttl = 900
  ): Promise<void> {
    const key = `token:${tokenType}:${token}`;
    const value = {
      data,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
    };
    
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttl
    });
  }

  /**
   * 验证并消费令牌
   * @param tokenType 令牌类型
   * @param token 令牌值
   * @returns 令牌关联的数据或null
   */
  async consumeToken(tokenType: string, token: string): Promise<any | null> {
    const key = `token:${tokenType}:${token}`;
    const tokenData = await this.kv.get(key, "json");
    
    if (!tokenData) return null;
    
    // 消费后删除令牌
    await this.kv.delete(key);
    
    return tokenData.data;
  }

  /**
   * 批量删除缓存
   * @param pattern 键前缀模式
   */
  async invalidateCache(pattern: string): Promise<number> {
    const { keys } = await this.kv.list({ prefix: pattern });
    const deletePromises = keys.map(key => this.kv.delete(key.name));
    await Promise.all(deletePromises);
    return keys.length;
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    keysByPrefix: Record<string, number>;
  }> {
    const { keys } = await this.kv.list();
    
    const stats = {
      totalKeys: keys.length,
      keysByPrefix: {} as Record<string, number>
    };

    for (const key of keys) {
      const prefix = key.name.split(':')[0];
      stats.keysByPrefix[prefix] = (stats.keysByPrefix[prefix] || 0) + 1;
    }

    return stats;
  }
}
```

## 🔄 服务集成与协作

### 统一服务管理器

**文件位置**: `app/.server/services/cloudflare-services.ts`

```typescript
import type { D1Database, R2Bucket, KVNamespace } from "@cloudflare/workers-types";
import { DatabaseService } from "./database";
import { R2StorageService } from "./r2-bucket";
import { KVCacheService } from "./kv-cache";

/**
 * Cloudflare服务管理器
 * 统一管理D1、R2、KV三个服务的实例
 */
export class CloudflareServicesManager {
  public readonly database: DatabaseService;
  public readonly storage: R2StorageService;
  public readonly cache: KVCacheService;

  constructor(
    d1: D1Database,
    r2: R2Bucket,
    kv: KVNamespace
  ) {
    this.database = new DatabaseService(d1);
    this.storage = new R2StorageService(r2);
    this.cache = new KVCacheService(kv);
  }

  /**
   * 创建AI任务的完整流程
   * 1. 上传文件到R2
   * 2. 创建数据库记录
   * 3. 缓存任务信息到KV
   */
  async createAiTask(
    userId: string,
    files: File[],
    taskParams: any
  ): Promise<{ taskId: string; uploadedFiles: any[] }> {
    try {
      // 1. 上传文件到R2
      const uploadedFiles = await this.storage.uploadFiles(files, "cache", userId);
      
      // 2. 创建数据库记录
      const taskId = crypto.randomUUID();
      const taskNo = `TASK_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      
      const task = await this.database.createAiTask({
        id: taskId,
        taskNo,
        userId,
        status: "pending",
        inputParams: JSON.stringify({
          ...taskParams,
          uploadedFiles: uploadedFiles.map(f => ({ key: f.key, url: f.url }))
        })
      });
      
      // 3. 缓存任务信息到KV
      await this.cache.cacheTaskResult(taskId, {
        status: "pending",
        createdAt: new Date().toISOString(),
        uploadedFiles
      }, 3600); // 1小时缓存
      
      return { taskId, uploadedFiles };
    } catch (error) {
      console.error("Failed to create AI task:", error);
      throw error;
    }
  }

  /**
   * 完成AI任务的处理流程
   * 1. 下载AI结果到R2
   * 2. 更新数据库状态
   * 3. 更新KV缓存
   */
  async completeAiTask(
    taskId: string,
    resultUrls: string[]
  ): Promise<{ storedResults: any[] }> {
    try {
      // 1. 下载AI结果到R2
      const storedResults = await this.storage.downloadFilesToBucket(
        resultUrls,
        "result",
        taskId
      );
      
      // 2. 更新数据库状态
      await this.database.updateAiTaskStatus(taskId, "completed", {
        resultUrls: JSON.stringify(storedResults.map(r => r.url))
      });
      
      // 3. 更新KV缓存
      await this.cache.cacheTaskResult(taskId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        resultUrls: storedResults.map(r => r.url)
      }, 7200); // 2小时缓存
      
      return { storedResults };
    } catch (error) {
      console.error("Failed to complete AI task:", error);
      
      // 更新为失败状态
      await this.database.updateAiTaskStatus(taskId, "failed", {
        failureReason: error instanceof Error ? error.message : "Unknown error"
      });
      
      throw error;
    }
  }

  /**
   * 获取用户任务列表（带缓存）
   */
  async getUserTasks(
    userId: string,
    limit = 20,
    offset = 0,
    useCache = true
  ): Promise<any[]> {
    const cacheKey = `user_tasks:${userId}:${limit}:${offset}`;
    
    if (useCache) {
      // 先尝试从缓存获取
      const cached = await this.cache.getCachedConfig(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    // 从数据库获取
    const tasks = await this.database.getUserAiTasks(userId, limit, offset);
    
    // 缓存结果
    if (useCache) {
      await this.cache.cacheConfig(cacheKey, tasks, 300); // 5分钟缓存
    }
    
    return tasks;
  }

  /**
   * 清理过期数据
   * 1. 清理R2中的过期缓存文件
   * 2. 清理KV中的过期缓存
   */
  async cleanupExpiredData(): Promise<{
    deletedFiles: number;
    deletedCacheKeys: number;
  }> {
    const [deletedFiles, deletedCacheKeys] = await Promise.all([
      // 清理7天前的缓存文件
      this.storage.cleanupExpiredCache(7),
      // 清理过期的临时缓存
      this.cache.invalidateCache("temp:")
    ]);
    
    return { deletedFiles, deletedCacheKeys };
  }

  /**
   * 获取服务健康状态
   */
  async getHealthStatus(): Promise<{
    database: boolean;
    storage: boolean;
    cache: boolean;
  }> {
    const results = await Promise.allSettled([
      // 测试数据库连接
      this.database.getUserById("health-check"),
      // 测试存储服务
      this.storage.listFiles("health-check", 1),
      // 测试缓存服务
      this.cache.getCachedConfig("health-check")
    ]);
    
    return {
      database: results[0].status === "fulfilled",
      storage: results[1].status === "fulfilled",
      cache: results[2].status === "fulfilled"
    };
  }
}
```

## 📊 性能监控与优化

### 性能指标监控

```typescript
/**
 * 性能监控装饰器
 */
export function performanceMonitor(serviceName: string, operationName: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const operationId = crypto.randomUUID();
      
      console.log(`[${serviceName}] Starting ${operationName}`, {
        operationId,
        timestamp: new Date().toISOString(),
        args: args.length
      });
      
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;
        
        console.log(`[${serviceName}] Completed ${operationName}`, {
          operationId,
          duration,
          success: true,
          timestamp: new Date().toISOString()
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        console.error(`[${serviceName}] Failed ${operationName}`, {
          operationId,
          duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        });
        
        throw error;
      }
    };
  };
}
```

### 最佳实践总结

#### 1. 数据一致性策略

- **D1作为主数据源**：所有结构化数据的权威来源
- **KV作为缓存层**：提高读取性能，减少D1查询
- **R2作为文件存储**：大文件和媒体资源的可靠存储

#### 2. 性能优化策略

- **读写分离**：读操作优先使用KV缓存，写操作直接操作D1
- **批量操作**：尽可能使用批量API减少网络往返
- **异步处理**：文件上传和AI处理使用异步队列
- **CDN加速**：R2文件通过CDN分发，提高全球访问速度

#### 3. 可靠性保证

- **错误重试**：网络错误和临时故障的自动重试机制
- **降级策略**：缓存不可用时直接查询数据库
- **数据备份**：重要数据的多重备份策略
- **监控告警**：关键指标的实时监控和告警

#### 4. 安全考虑

- **访问控制**：基于用户角色的数据访问控制
- **数据加密**：敏感数据的加密存储
- **审计日志**：关键操作的完整审计记录
- **防护措施**：防止数据泄露和恶意攻击

## 🎯 总结

Cloudflare的D1、R2、KV三个服务在AI发型变换应用中形成了完整的数据存储生态：

- **D1数据库**提供可靠的结构化数据存储和ACID事务支持
- **R2对象存储**提供高性能的文件存储和全球CDN分发
- **KV键值存储**提供低延迟的缓存和会话管理

通过合理的架构设计和优化策略，这三个服务协同工作，为应用提供了高性能、高可用、全球化的数据存储解决方案。