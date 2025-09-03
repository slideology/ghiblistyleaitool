# 手动为用户添加积分指南

## 方法一：使用 Cloudflare D1 控制台（推荐）

### 步骤 1：登录 Cloudflare Dashboard
1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 登录你的账号
3. 进入 D1 数据库管理页面
4. 选择你的项目数据库

### 步骤 2：查找用户
首先执行以下 SQL 查找用户：

```sql
-- 查找用户（请将 your-email@example.com 替换为实际邮箱）
SELECT id, email, nickname FROM users WHERE email = 'your-email@example.com';
```

### 步骤 3：添加积分
找到用户ID后，执行以下 SQL 添加积分：

```sql
-- 为用户添加积分（请替换相应的值）
INSERT INTO credit_records (
  user_id,           -- 替换为步骤2查询到的用户ID
  credits,           -- 要添加的积分数量
  remaining_credits, -- 剩余积分（与credits相同）
  trans_type,        -- 交易类型：adjustment（手动调整）
  source_type,       -- 来源类型：manual（手动）
  source_id,         -- 来源ID：可以是任意标识
  note,              -- 备注信息
  created_at,        -- 创建时间
  updated_at         -- 更新时间
) VALUES (
  1,                 -- 请替换为实际的用户ID
  100,               -- 请替换为要添加的积分数量
  100,               -- 请替换为要添加的积分数量（与上面相同）
  'adjustment',      -- 交易类型
  'manual',          -- 来源类型
  'admin_manual_' || strftime('%s', 'now'), -- 生成唯一的来源ID
  '管理员手动添加积分',  -- 备注信息
  strftime('%s', 'now'),  -- 当前时间戳
  strftime('%s', 'now')   -- 当前时间戳
);
```

### 步骤 4：验证结果
执行以下 SQL 验证积分是否添加成功：

```sql
-- 查看用户的积分记录
SELECT 
  cr.id,
  u.email,
  u.nickname,
  cr.credits,
  cr.remaining_credits,
  cr.trans_type,
  cr.note,
  datetime(cr.created_at, 'unixepoch') as created_time
FROM credit_records cr
JOIN users u ON cr.user_id = u.id
WHERE u.email = 'your-email@example.com'  -- 请替换为实际邮箱
ORDER BY cr.created_at DESC
LIMIT 10;
```

### 步骤 5：查看用户总积分
```sql
-- 查看用户当前可用积分总数
SELECT 
  u.email,
  u.nickname,
  SUM(cr.remaining_credits) as total_available_credits
FROM users u
LEFT JOIN credit_records cr ON u.id = cr.user_id
WHERE u.email = 'your-email@example.com'  -- 请替换为实际邮箱
GROUP BY u.id, u.email, u.nickname;
```

## 方法二：使用 Node.js 脚本

项目中已经创建了 `add-credits.js` 脚本，你可以运行：

```bash
node add-credits.js <用户邮箱> <积分数量> [备注]
```

示例：
```bash
node add-credits.js user@example.com 100 "手动充值"
```

## 积分类型说明

- `initilize`: 初始积分（新用户注册时）
- `purchase`: 购买获得的积分
- `subscription`: 订阅赠送的积分
- `adjustment`: 手动调整的积分（推荐用于手动添加）

## 注意事项

1. **备份数据**：在执行任何数据库操作前，建议先备份数据
2. **验证用户**：确保用户邮箱正确，避免给错误的用户添加积分
3. **记录操作**：在 `note` 字段中详细记录添加原因，便于后续追踪
4. **积分有效期**：如需设置积分有效期，可以设置 `expired_at` 字段
5. **权限控制**：确保只有授权人员可以执行此操作

## 常见问题

### Q: 如何设置积分有效期？
A: 在插入积分记录时，设置 `expired_at` 字段：
```sql
-- 设置30天后过期
expired_at: strftime('%s', 'now', '+30 days')
```

### Q: 如何查看用户的积分使用历史？
A: 查询积分消费记录：
```sql
SELECT 
  cc.id,
  u.email,
  cc.credits as consumed_credits,
  cc.reason,
  cc.source_type,
  cc.source_id,
  datetime(cc.created_at, 'unixepoch') as consumed_time
FROM credit_consumptions cc
JOIN users u ON cc.user_id = u.id
WHERE u.email = 'your-email@example.com'
ORDER BY cc.created_at DESC;
```

### Q: 如何撤销错误添加的积分？
A: 可以删除对应的积分记录（谨慎操作）：
```sql
-- 删除指定的积分记录（请确认record_id正确）
DELETE FROM credit_records WHERE id = <record_id>;
```
