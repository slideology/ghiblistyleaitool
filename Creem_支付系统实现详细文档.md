# Creem支付系统实现详细文档

## 📋 概述

本文档详细阐述了AI发型变换项目中Creem支付系统的完整实现，包括支付流程架构、产品配置、Webhook处理、安全保障和异常处理机制。Creem是一个现代化的支付处理服务，专为SaaS产品设计，支持一次性支付和订阅模式。

## 🏗️ 技术架构

### 核心组件

#### 1. Creem API客户端
**文件位置**: `app/.server/libs/creem/client.ts`

```typescript
export class CreemApiClient {
  private baseUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(baseUrl?: string, apiKey?: string, webhookSecret?: string) {
    this.baseUrl = baseUrl || "https://api.creem.io";
    this.apiKey = apiKey || env.CREEM_KEY;
    this.webhookSecret = webhookSecret || env.CREEM_WEBHOOK_SECRET;
  }

  // 创建支付会话
  async createCheckout(payload: CreateCheckoutsPayload): Promise<CreateCheckoutsResponse>
  
  // 获取支付信息
  async getCheckout(checkoutId: string): Promise<Checkout>
  
  // 创建回调签名
  createCallbackSignature(params: CreateCallbackSignatureParams): string
  
  // 创建Webhook签名
  createWebhookSignature(payload: string): string
  
  // 验证Webhook签名
  verifyWebhookSignature(signature: string, payload: string): boolean
}
```

#### 2. 环境配置管理
**文件位置**: `app/.server/libs/creem/index.ts`

```typescript
export const createCreem = () => {
  let client: CreemApiClient;
  if (import.meta.env.PROD) {
    // 生产环境
    client = new CreemApiClient();
  } else {
    // 测试环境
    client = new CreemApiClient(
      "https://test-api.creem.io",
      env.CREEM_TEST_KEY
    );
  }
  return client;
};
```

### 数据库设计

#### 订单表结构
```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,        -- 订单编号
  order_detail TEXT,                    -- 订单详情(JSON)
  user_id INTEGER NOT NULL,             -- 用户ID
  product_id TEXT NOT NULL,             -- 商品ID
  product_name TEXT NOT NULL,           -- 商品名称
  amount INTEGER NOT NULL,              -- 支付金额(分)
  status TEXT NOT NULL,                 -- 订单状态
  pay_session_id TEXT UNIQUE,           -- 支付会话ID
  pay_provider TEXT DEFAULT 'creem',    -- 支付提供商
  session_detail TEXT,                  -- 会话详情(JSON)
  paid_at INTEGER,                      -- 支付时间
  paid_email TEXT,                      -- 支付邮箱
  paid_detail TEXT,                     -- 支付详情(JSON)
  subscription_id INTEGER,              -- 订阅ID(可选)
  sub_id TEXT,                          -- 平台订阅ID(可选)
  is_error BOOLEAN DEFAULT FALSE,       -- 是否有错误
  error_msg TEXT,                       -- 错误信息
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 订单状态流转
- **pending**: 待支付
- **processing**: 支付成功，处理中
- **completed**: 订单完成
- **refunded**: 已退款
- **cancelled**: 已取消

## 🔄 支付流程架构

### 1. 订单创建流程

#### 前端发起支付
```typescript
// 用户点击购买按钮
const handlePurchase = async (productId: string) => {
  try {
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId })
    });
    
    const { checkout_url } = await response.json();
    
    // 跳转到Creem支付页面
    window.location.href = checkout_url;
  } catch (error) {
    console.error('支付发起失败:', error);
  }
};
```

#### 后端订单创建
**文件位置**: `app/.server/services/order.ts`

```typescript
export const createOrder = async (payload: CreateOrderOptions, user: User) => {
  // 1. 生成唯一订单号
  const orderNo = generateUniqueOrderNo();
  
  // 2. 创建订单记录
  const [order] = await insertOrder({
    order_no: orderNo,
    order_detail: payload,
    user_id: user.id,
    product_id: payload.product_id,
    product_name: payload.product_name,
    amount: currency(payload.price).intValue,
    status: "pending",
  });
  
  // 3. 创建Creem支付会话
  const creem = createCreem();
  const session = await creem.createCheckout({
    product_id: order.product_id,
    customer: { email: user.email },
    success_url: new URL("/callback/payment", env.DOMAIN).toString(),
  });
  
  // 4. 更新订单支付信息
  await updateOrder(order.id, {
    pay_session_id: session.id,
    pay_provider: "creem",
    session_detail: session,
  });
  
  return session;
};
```

### 2. 支付完成处理

#### 支付回调处理
**文件位置**: `app/routes/_callback/payment/route.ts`

```typescript
export const loader = async ({ request }: Route.LoaderArgs) => {
  const searchParams = new URL(request.url).searchParams;
  const paramsRecord: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    paramsRecord[key] = value;
  });

  const { signature: creemSignature, ...rest } = paramsRecord;
  const creem = createCreem();
  const signature = creem.createCallbackSignature(rest);

  try {
    // 验证签名
    if (creemSignature !== signature) {
      throw Error("Invalid Signature");
    }

    // 处理订单完成
    await handleOrderComplete(rest.checkout_id);

    return redirect("/");
  } catch (error) {
    console.log("Error Event: ", paramsRecord);
    console.log("Error Message: ", error.message);
    return redirect("/");
  }
};
```

#### 订单完成逻辑
```typescript
export const handleOrderComplete = async (checkoutId: string) => {
  // 1. 获取支付信息
  const creem = createCreem();
  const checkout = await creem.getCheckout(checkoutId);
  
  if (!checkout || checkout.status !== "completed") {
    throw Error("Invalid checkout");
  }
  
  // 2. 查找对应订单
  const order = await getOrderBySessionId(checkout.id);
  if (!order || order.status !== "pending") {
    throw Error("Invalid transaction");
  }
  
  // 3. 更新订单状态
  const customer = checkout.customer as Customer;
  await updateOrder(order.id, {
    paid_at: new Date(),
    paid_email: customer.email,
    paid_detail: checkout,
    status: "processing",
  });
  
  // 4. 处理业务逻辑
  const orderDetail = order.order_detail as CreateOrderOptions;
  const { type, credits, plan_id } = orderDetail;
  
  if (type === "once") {
    // 一次性购买：发放积分
    if (credits) {
      await insertCreditRecord({
        user_id: order.user_id,
        credits: credits,
        remaining_credits: credits,
        trans_type: "purchase",
        source_type: "order",
        source_id: order.order_no,
      });
    }
    
    // 完成订单
    const [result] = await updateOrder(order.id, {
      status: "completed",
    });
    
    return result;
  } else {
    // 订阅购买：创建订阅记录
    const plan = PRICING_LIST.find((item) => item.id === plan_id);
    
    if (!plan) {
      // 处理错误情况
      const [result] = await updateOrder(order.id, {
        status: "completed",
        is_error: true,
        error_msg: "Invalid Subscription Plan",
      });
      return result;
    }
    
    // 创建订阅记录和发放积分
    const expiredAt = dayjs()
      .add(1, orderDetail.type === "yearly" ? "year" : "month")
      .endOf("day")
      .toDate();
      
    const subscription = checkout.subscription as Subscription;
    const [sub] = await insertSubscription({
      user_id: order.user_id,
      plan_type: plan.id,
      status: "active",
      interval: orderDetail.type === "yearly" ? "year" : "month",
      interval_count: 1,
      platform_sub_id: subscription.id,
      start_at: dayjs().startOf("day").toDate(),
      expired_at: expiredAt,
      last_payment_at: new Date(),
    });
    
    // 发放订阅积分
    if (plan.limit.credits) {
      await insertCreditRecord({
        user_id: order.user_id,
        credits: plan.limit.credits,
        remaining_credits: plan.limit.credits,
        trans_type: "subscription",
        source_type: "order",
        source_id: order.order_no,
        expired_at: expiredAt,
      });
    }
    
    const [result] = await updateOrder(order.id, {
      status: "completed",
      sub_id: subscription.id,
      subscription_id: sub.id,
    });
    
    return result;
  }
};
```

## 🔗 Webhook处理机制

### Webhook路由
**文件位置**: `app/routes/_webhooks/payment/route.ts`

```typescript
export const action = async ({ request }: Route.ActionArgs) => {
  if (request.method.toLowerCase() !== "post") {
    return new Response("Fail Method", { status: 405 });
  }
  
  const body = await request.text();
  const creemSignature = request.headers.get("creem-signature");
  const creem = createCreem();
  const signature = creem.createWebhookSignature(body);

  try {
    // 验证签名
    if (creemSignature !== signature) {
      throw Error("Invalid Signature");
    }

    const { eventType, ...rest } = JSON.parse(body) as WebhookBody;

    // 处理不同事件类型
    if (eventType === "checkout.completed") {
      const checkout = rest.object as Checkout;
      await handleOrderComplete(checkout.id);
    } else if (eventType === "refund.created") {
      const refund = rest.object as Refund;
      await handleOrderRefund(refund.checkout.id);
    }
    
    return Response.json({}, { status: 200 });
  } catch (error) {
    const message = (error as Error).message;
    console.log("Error Event: ", body);
    console.log("Error Message: ", message);
    return Response.json({ message }, { status: 400 });
  }
};
```

### 支持的Webhook事件

1. **checkout.completed**: 支付完成
2. **refund.created**: 退款创建
3. **subscription.active**: 订阅激活
4. **subscription.paid**: 订阅付款
5. **subscription.canceled**: 订阅取消
6. **subscription.expired**: 订阅过期

## 💰 产品配置管理

### 产品定义
**文件位置**: `app/.server/constants/product.ts`

```typescript
export interface PRODUCT {
  price: number;                    // 价格(元)
  credits: number;                  // 积分数量
  product_id: string;               // Creem产品ID
  product_name: string;             // 产品名称
  type: "once" | "monthly" | "yearly"; // 产品类型
}

export const CREDITS_PRODUCT: PRODUCT = {
  price: 9,
  credits: 100,
  product_id: import.meta.env.PROD
    ? "prod_3q2PT9pqzfw5URK7TdIhyb"    // 生产环境产品ID
    : "prod_tMa1e6wOR5SnpYzLKUVaP",   // 测试环境产品ID
  product_name: "Credits Pack",
  type: "once",
};

export const PRODUCTS_LIST = [CREDITS_PRODUCT];
```

### 订阅计划配置
**文件位置**: `app/.server/constants/pricing.ts`

```typescript
export interface PLAN {
  id: string;
  popular: boolean;
  product_id: { monthly: string; yearly: string } | null;
  price: { monthly: number; yearly: number };
  name: string;
  description: string;
  limit: {
    adblock: boolean;           // 是否关闭广告
    watermarks: boolean;        // 生成的结果是否显示水印
    highResolution: boolean;    // 是否生成高质量图像
    fullStyles: boolean;        // 是否允许使用完整风格
    credits: number;            // 每月赠送积分
    private: boolean;           // 是否私有化生成
    features: boolean;          // 允许使用实验性功能
  };
}

export const PREMIUM_PLAN: PLAN = {
  id: "premium",
  popular: true,
  price: { monthly: 4.99, yearly: 49.9 },
  product_id: {
    monthly: "xxx",  // 月订阅商品编码
    yearly: "xxx",   // 年订阅商品编码
  },
  name: "Premium Plan",
  description: "Support full styles and Ad-free experience, get no watermarks and high resolution image.",
  limit: {
    adblock: true,
    watermarks: false,
    highResolution: true,
    fullStyles: true,
    credits: 100,
    private: true,
    features: false,
  },
};
```

## 🔒 安全保障机制

### 1. 签名验证

#### Webhook签名验证
```typescript
// HMAC-SHA256签名验证
createWebhookSignature(payload: string): string {
  const computedSignature = crypto
    .createHmac("sha256", this.webhookSecret)
    .update(payload)
    .digest("hex");
  return computedSignature;
}

// 时间安全比较
verifyWebhookSignature(signature: string, payload: string): boolean {
  const computedSignature = this.createWebhookSignature(payload);
  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(computedSignature, "hex")
  );
}
```

#### 回调签名验证
```typescript
// 回调参数签名验证
createCallbackSignature(params: CreateCallbackSignatureParams): string {
  const data = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .concat(`salt=${this.apiKey}`)
    .join("|");

  return crypto.createHash("sha256").update(data).digest("hex");
}
```

### 2. 环境隔离

```typescript
// 生产环境和测试环境自动切换
export const createCreem = () => {
  let client: CreemApiClient;
  if (import.meta.env.PROD) {
    // 生产环境配置
    client = new CreemApiClient(
      "https://api.creem.io",
      env.CREEM_KEY,
      env.CREEM_WEBHOOK_SECRET
    );
  } else {
    // 测试环境配置
    client = new CreemApiClient(
      "https://test-api.creem.io",
      env.CREEM_TEST_KEY,
      env.CREEM_WEBHOOK_SECRET
    );
  }
  return client;
};
```

### 3. 数据验证

```typescript
// 订单状态验证
if (!checkout || checkout.status !== "completed") {
  throw Error("Invalid checkout");
}

// 订单重复处理防护
if (order.status !== "pending") {
  throw Error(`Transaction is ${order.status}`);
}

// 用户权限验证
const user = session.get("user");
if (!user) throw new Response("Unauthorized", { status: 401 });
```

## ⚠️ 异常处理机制

### 1. 支付异常处理

```typescript
try {
  // 支付处理逻辑
  await handleOrderComplete(checkout.id);
} catch (error) {
  // 记录错误日志
  console.log("Error Event: ", body);
  console.log("Error Message: ", error.message);
  
  // 返回错误响应
  return Response.json({ message: error.message }, { status: 400 });
}
```

### 2. 订单状态回滚

```typescript
// 订阅计划验证失败时的处理
if (!plan) {
  const [result] = await updateOrder(order.id, {
    status: "completed",
    is_error: true,
    error_msg: "Invalid Subscription Plan",
  });
  return result;
}
```

### 3. 退款处理

```typescript
export const handleOrderRefund = async (checkoutId: string) => {
  const creem = createCreem();
  const checkout = await creem.getCheckout(checkoutId);
  
  if (!checkout || checkout.status !== "completed") {
    throw Error("Invalid checkout");
  }

  const order = await getOrderBySessionId(checkout.id);
  if (!order || order.status !== "completed") {
    throw Error(`Transaction is ${order.status}`);
  }

  // 取消订阅
  if (order.subscription_id) {
    const subscription = await getSubscriptionById(order.subscription_id);
    if (subscription) {
      await updateSubscription(subscription.id, {
        status: "cancelled",
        expired_at: new Date(),
        cancel_at: new Date(),
      });
    }
  }

  // 回收积分
  const credit = await getCreditRecordBySourceId(order.order_no);
  if (credit && credit.remaining_credits > 0) {
    await updateCreditRecord(credit.id, { remaining_credits: 0 });
    await insertCreditConsumption({
      user_id: credit.user_id,
      credits: credit.remaining_credits,
      credit_record_id: credit.id,
      reason: "Order Refund",
    });
  }

  // 更新订单状态
  const [result] = await updateOrder(order.id, {
    status: "refunded",
  });

  return result;
};
```

## 🚀 配置和部署

### 环境变量配置

```json
// wrangler.jsonc
{
  "vars": {
    // Creem支付配置
    "CREEM_KEY": "生产环境API密钥",
    "CREEM_TEST_KEY": "测试环境API密钥",
    "CREEM_WEBHOOK_SECRET": "Webhook签名密钥",
    
    // 基础配置
    "DOMAIN": "https://your-domain.com",
    "SESSION_SECRET": "会话加密密钥"
  }
}
```

### Creem平台配置

1. **创建产品**
   - 登录Creem控制台
   - 创建产品并获取product_id
   - 配置产品价格和描述

2. **配置Webhook**
   - 设置Webhook URL: `https://your-domain.com/webhooks/payment`
   - 配置签名密钥
   - 选择需要的事件类型

3. **获取API密钥**
   - 生产环境API密钥
   - 测试环境API密钥
   - Webhook签名密钥

## 📊 监控和日志

### 1. 支付日志记录

```typescript
// 记录支付事件
console.log("Payment Event: ", {
  eventType,
  checkoutId: checkout.id,
  orderId: order.id,
  userId: order.user_id,
  amount: order.amount,
  timestamp: new Date().toISOString()
});

// 记录错误信息
console.log("Error Event: ", body);
console.log("Error Message: ", message);
```

### 2. 订单状态监控

```typescript
// 订单状态变更日志
const logOrderStatusChange = (orderId: number, oldStatus: string, newStatus: string) => {
  console.log(`Order ${orderId} status changed: ${oldStatus} -> ${newStatus}`);
};
```

### 3. 性能监控

```typescript
// API响应时间监控
const startTime = Date.now();
try {
  await handleOrderComplete(checkout.id);
  const duration = Date.now() - startTime;
  console.log(`Order completion took ${duration}ms`);
} catch (error) {
  const duration = Date.now() - startTime;
  console.log(`Order completion failed after ${duration}ms:`, error.message);
}
```

## 🔧 最佳实践

### 1. 幂等性处理

```typescript
// 防止重复处理同一订单
if (order.status !== "pending") {
  console.log(`Order ${order.id} already processed with status: ${order.status}`);
  return order;
}
```

### 2. 事务处理

```typescript
// 使用数据库事务确保数据一致性
const db = connectDB();
const result = await db.transaction(async (tx) => {
  // 更新订单状态
  await tx.update(schema.orders)
    .set({ status: "completed" })
    .where(eq(schema.orders.id, order.id));
  
  // 发放积分
  await tx.insert(schema.creditRecords)
    .values(creditData);
  
  return order;
});
```

### 3. 错误重试机制

```typescript
// 实现指数退避重试
const retryWithBackoff = async (fn: () => Promise<any>, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // 指数退避
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};
```

## 🐛 故障排除

### 常见问题及解决方案

#### 1. Webhook签名验证失败

**问题**: `Invalid Signature` 错误

**解决方案**:
- 检查CREEM_WEBHOOK_SECRET配置是否正确
- 确认Webhook URL配置正确
- 验证请求头中的签名格式

```typescript
// 调试签名验证
const receivedSignature = request.headers.get("creem-signature");
const computedSignature = creem.createWebhookSignature(body);
console.log("Received:", receivedSignature);
console.log("Computed:", computedSignature);
```

#### 2. 订单状态异常

**问题**: 订单状态不正确导致处理失败

**解决方案**:
- 检查订单状态流转逻辑
- 确认数据库事务完整性
- 添加订单状态日志记录

#### 3. 积分发放失败

**问题**: 支付成功但积分未发放

**解决方案**:
- 检查积分记录插入逻辑
- 验证用户ID和订单关联
- 确认积分计算逻辑正确

### 调试工具

```typescript
// 开发环境调试日志
if (!import.meta.env.PROD) {
  console.log("Debug Info:", {
    checkoutId,
    orderStatus: order.status,
    userCredits: await getUserCredits(order.user_id),
    orderDetail: order.order_detail
  });
}
```

## 📈 性能优化建议

### 1. 数据库优化

```sql
-- 添加索引优化查询性能
CREATE INDEX idx_orders_session_id ON orders(pay_session_id);
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

### 2. 缓存策略

```typescript
// 缓存产品配置
const productCache = new Map<string, PRODUCT>();

const getProduct = (productId: string): PRODUCT | undefined => {
  if (!productCache.has(productId)) {
    const product = PRODUCTS_LIST.find(p => p.product_id === productId);
    if (product) productCache.set(productId, product);
  }
  return productCache.get(productId);
};
```

### 3. 异步处理

```typescript
// 使用Cloudflare Workers的waitUntil进行异步处理
export const action = async ({ request, context }: Route.ActionArgs) => {
  // 立即返回响应
  const response = Response.json({}, { status: 200 });
  
  // 异步处理业务逻辑
  context.waitUntil(
    handleOrderComplete(checkout.id)
      .catch(error => console.error('Async processing failed:', error))
  );
  
  return response;
};
```

## 📝 总结

Creem支付系统实现了完整的支付流程，包括：

### 核心特性
- **多环境支持**: 自动切换生产和测试环境
- **安全验证**: HMAC-SHA256签名验证机制
- **完整流程**: 订单创建、支付处理、积分发放、退款处理
- **异常处理**: 完善的错误处理和状态回滚机制
- **监控日志**: 详细的操作日志和性能监控

### 技术亮点
- **类型安全**: TypeScript全链路类型保护
- **事务处理**: 数据库事务确保数据一致性
- **幂等性**: 防止重复处理同一订单
- **可扩展性**: 支持一次性购买和订阅模式
- **高性能**: 基于Cloudflare Workers的边缘计算

该支付系统架构清晰、安全可靠，可作为SaaS产品支付集成的参考实现。通过合理的架构设计和完善的异常处理机制，确保了支付流程的稳定性和用户体验。