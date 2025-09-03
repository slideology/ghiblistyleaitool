# KIE AI API 接入实现文档

## 概述

KIE AI 是本项目使用的主要AI图像生成服务提供商，支持两种AI模型：
- **GPT-4o**: 基于OpenAI GPT-4o的图像生成模型
- **Flux Kontext**: 专业的图像生成模型

本文档详细说明了KIE AI API在项目中的接入实现方式、配置要求和使用流程。

## 1. 项目架构

### 1.1 核心文件结构
```
app/.server/aisdk/
├── index.ts              # 导出KIE AI相关类型和类
└── kie-ai/
    ├── index.ts          # KIE AI客户端主类
    └── type.ts           # API数据类型定义
```

### 1.2 相关服务文件
```
app/.server/services/
└── ai-tasks.ts           # AI任务管理服务

app/routes/_webhooks/
└── kie-image/
    └── route.ts          # KIE AI回调处理
```

## 2. KIE AI 客户端实现

### 2.1 主要类：KieAI

**文件位置**: `app/.server/aisdk/kie-ai/index.ts`

```typescript
export class KieAI {
  private API_URL = new URL("https://kieai.erweima.ai");
  private readonly config: KieAIModelConfig = { accessKey: env.KIEAI_APIKEY };

  constructor(config?: KieAIModelConfig) {
    if (config) this.config = config;
  }
}
```

### 2.2 核心功能方法

#### 2.2.1 GPT-4o 模型相关方法

```typescript
// 创建GPT-4o图像生成任务
async create4oTask(payload: Create4oTaskOptions)

// 查询GPT-4o任务详情
async query4oTaskDetail(params: QueryTaskParams)

// 获取GPT-4o结果下载链接
async get4oDownloadURL(params: Get4oDirectDownloadURLOptions)
```

#### 2.2.2 Kontext 模型相关方法

```typescript
// 创建Kontext图像生成任务
async createKontextTask(payload: CreateKontextOptions)

// 查询Kontext任务状态
async queryKontextTask(params: QueryTaskParams)
```

#### 2.2.3 通用方法

```typescript
// 查询剩余积分
async getCreditsRemaining()
```

### 2.3 HTTP请求封装

```typescript
private async fetch<T = any>(
  path: string,
  data?: Record<string, any>,
  init: RequestInit = {}
) {
  const { headers, method = "get", ...rest } = init;
  const url = new URL(path, this.API_URL);
  const options: RequestInit = {
    ...rest,
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
      Authorization: `Bearer ${this.config.accessKey}`,
    },
  };
  
  // GET请求参数处理
  if (data) {
    if (method.toLowerCase() === "get") {
      Object.entries(data).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    } else {
      options.body = JSON.stringify(data);
    }
  }

  const response = await fetch(url, options);
  const json = await response.json<ApiResult<T>>();

  // 错误处理
  if (!response.ok || json.code !== 200) {
    throw {
      code: json.code ?? response.status,
      message: json.msg ?? response.statusText,
      data: json ? json.data : json,
    };
  }

  return json;
}
```

## 3. API 数据类型定义

### 3.1 通用类型

```typescript
// API响应格式
export interface ApiResult<T = any> {
  code: number;
  msg: string;
  data: T;
}

// 任务查询参数
interface QueryTaskParams {
  taskId: string;
}

// 任务创建结果
interface CreateTaskResult {
  taskId: string;
}
```

### 3.2 GPT-4o 相关类型

```typescript
// 支持的图片比例
export type GPT4oAspect = "3:2" | "1:1" | "2:3";

// 创建任务选项
export interface Create4oTaskOptions {
  filesUrl?: string[];        // 输入图片URL数组
  prompt: string;            // 生成提示词
  size: GPT4oAspect;         // 图片比例
  callBackUrl?: string;      // 回调URL
  nVariants?: "1" | "2" | "4"; // 生成变体数量
}

// 任务状态
export interface GPT4oTask {
  taskId: string;
  paramJson: string;
  completeTime: string | null;
  response: {
    resultUrls: string[];
  } | null;
  successFlag: 0 | 1;
  status: "GENERATING" | "SUCCESS" | "CREATE_TASK_FAILED" | "GENERATE_FAILED";
  errorCode: number;
  errorMessage: string;
  createTime: string;
  progress: string;
}
```

### 3.3 Kontext 相关类型

```typescript
// 支持的图片比例
export type KontextAspect =
  | "21:9" | "16:9" | "4:3" | "1:1" 
  | "3:4" | "9:16" | "16:21";

// 创建任务选项
export interface CreateKontextOptions {
  prompt: string;                    // 生成提示词
  inputImage?: string;               // 输入图片URL
  enableTranslation?: boolean;       // 启用翻译
  aspectRatio?: KontextAspect;       // 图片比例
  outputFormat?: "jpeg" | "png";     // 输出格式
  promptUpsampling?: boolean;        // 提示词增强
  model?: "flux-kontext-pro" | "flux-kontext-max"; // 模型选择
  callBackUrl?: string;              // 回调URL
  watermark?: string;                // 水印
}

// 任务状态
export interface KontextTask {
  taskId: string;
  paramJson: string;
  completeTime: string | null;
  response: {
    originImageUrl: string;
    resultImageUrl: string;
  } | null;
  successFlag: 0 | 1 | 2 | 3;
  errorCode: number;
  errorMessage: string;
  createTime: string;
}
```

## 4. 业务集成实现

### 4.1 AI任务创建流程

**文件位置**: `app/.server/services/ai-tasks.ts`

#### 4.1.1 GPT-4o 任务创建

```typescript
if (type === "gpt-4o") {
  const aspect = "2:3";
  const callbakUrl = new URL("/webhooks/kie-image", env.DOMAIN).toString();

  insertPayloads = hairstyle.map<InsertAiTask>((style) => {
    const filesUrl = [fileUrl];
    if (style.cover) filesUrl.push(style.cover);
    if (hair_color.cover) filesUrl.push(hair_color.cover);

    const params: Create4oTaskOptions = {
      filesUrl: filesUrl,
      prompt: createAiHairstyleChangerPrompt({
        hairstyle: style.name,
        haircolor: hair_color.name,
        haircolorHex: hair_color.value,
        withStyleReference: !!style.cover,
        withColorReference: !!hair_color.cover,
        detail: detail,
      }),
      size: aspect,
      nVariants: "4",
      callBackUrl: import.meta.env.PROD ? callbakUrl : undefined,
    };

    return {
      user_id: user.id,
      status: "pending",
      estimated_start_at: new Date(),
      input_params: inputParams,
      ext,
      aspect: aspect,
      provider: "kie_4o",
      request_param: params,
    };
  });
}
```

#### 4.1.2 Kontext 任务创建

```typescript
else if (type === "kontext") {
  const aspect = "3:4";
  const callbakUrl = new URL("/webhooks/kie-image", env.DOMAIN).toString();

  insertPayloads = hairstyle.map<InsertAiTask>((style) => {
    const params: CreateKontextOptions = {
      inputImage: fileUrl,
      prompt: createHairstyleChangerKontext({
        hairstyle: style.name,
        haircolor: hair_color.name,
        detail: detail,
      }),
      aspectRatio: aspect,
      model: "flux-kontext-pro",
      outputFormat: "png",
      callBackUrl: import.meta.env.PROD ? callbakUrl : undefined,
    };

    return {
      user_id: user.id,
      status: "pending",
      estimated_start_at: new Date(),
      input_params: inputParams,
      ext,
      aspect: aspect,
      provider: "kie_kontext",
      request_param: params,
    };
  });
}
```

### 4.2 任务启动流程

```typescript
export const startTask = async (params: AiTask["task_no"] | AiTask) => {
  // 获取任务信息
  let task: AiTask;
  if (typeof params === "string") {
    const result = await getAiTaskByTaskNo(params);
    if (!result) throw Error("Unvalid Task No");
    task = result;
  } else task = params;

  // 状态检查
  if (task.status !== "pending") {
    throw Error("Task is not in Pending");
  }

  const kie = new KieAI();
  let newTask: AiTask;
  
  // 根据提供商启动任务
  if (task.provider === "kie_4o") {
    const result = await kie.create4oTask(
      task.request_param as Create4oTaskOptions
    );
    const res = await updateAiTask(task.task_no, {
      task_id: result.taskId,
      status: "running",
      started_at: new Date(),
    });
    newTask = res[0];
  } else if (task.provider === "kie_kontext") {
    const result = await kie.createKontextTask(
      task.request_param as CreateKontextOptions
    );
    const res = await updateAiTask(task.task_no, {
      task_id: result.taskId,
      status: "running",
      started_at: new Date(),
    });
    newTask = res[0];
  }

  return transformResult(newTask);
};
```

### 4.3 任务状态更新流程

```typescript
export const updateTaskStatus = async (taskNo: AiTask["task_no"] | AiTask) => {
  // 获取任务
  let task: AiTask | undefined | null;
  if (typeof taskNo === "string") {
    task = await getAiTaskByTaskNo(taskNo);
  } else task = taskNo;

  if (!task) throw Error("Unvalid Task No");
  
  // 处理pending状态 - 尝试启动任务
  if (task.status === "pending") {
    try {
      const result = await startTask(task);
      return { task: result, progress: 0 };
    } catch {
      return { task: transformResult(task), progress: 0 };
    }
  }
  
  // 处理非running状态 - 直接返回
  if (task.status !== "running") {
    return { task: transformResult(task), progress: 1 };
  }

  const kie = new KieAI();

  // GPT-4o任务状态查询
  if (task.provider === "kie_4o") {
    const result = await kie.query4oTaskDetail({ taskId: task.task_id });
    
    if (result.status === "GENERATING") {
      return {
        task: transformResult(task),
        progress: currency(result.progress).intValue,
      };
    } else if (result.status === "SUCCESS") {
      let resultUrl = result.response?.resultUrls[0];
      
      // 下载结果到R2存储
      if (import.meta.env.PROD && resultUrl) {
        try {
          const [file] = await downloadFilesToBucket(
            [{ src: resultUrl, fileName: task.task_no, ext: "png" }],
            "result/hairstyle"
          );
          if (file) resultUrl = new URL(file.key, env.CDN_URL).toString();
        } catch {}
      }

      const [aiTask] = await updateAiTask(task.task_no, {
        status: "succeeded",
        completed_at: new Date(),
        result_data: result,
        result_url: resultUrl,
      });
      
      return { task: transformResult(aiTask), progress: 1 };
    }
  }
  
  // Kontext任务状态查询
  else if (task.provider === "kie_kontext") {
    const result = await kie.queryKontextTask({ taskId: task.task_id });
    
    if (result.successFlag === 0) {
      return { task: transformResult(task), progress: 0 };
    } else if (result.successFlag === 1) {
      let resultUrl = result.response?.resultImageUrl ?? result.response?.originImageUrl;
      
      // 类似的结果处理逻辑...
    }
  }
};
```

## 5. Webhook 回调处理

### 5.1 回调路由实现

**文件位置**: `app/routes/_webhooks/kie-image/route.ts`

```typescript
export const action = async ({ request }: Route.ActionArgs) => {
  // 解析回调数据
  const json = await request.json<GPT4oTaskCallbackJSON>();
  
  // 验证任务ID
  if (!json.data?.taskId) return data({});
  
  // 更新任务状态
  await updateTaskStatusByTaskId(json.data.taskId);

  return data({});
};
```

### 5.2 回调数据格式

```typescript
export type GPT4oTaskCallbackJSON = ApiResult<{
  info: { result_urls: string[] };
  taskId: string;
}>;
```

## 6. 环境配置

### 6.1 环境变量配置

**开发环境** (`.env`):
```bash
# KIE AI API密钥
KIEAI_APIKEY=e5edf75c9a84948ffb29bcedbc456ba8
```

**生产环境** (`wrangler.jsonc`):
```json
{
  "vars": {
    "KIEAI_APIKEY": "e5edf75c9a84948ffb29bcedbc456ba8"
  }
}
```

### 6.2 回调URL配置

回调URL格式：`{DOMAIN}/webhooks/kie-image`

例如：
- 开发环境：`http://localhost:5173/webhooks/kie-image`
- 生产环境：`https://example.com/webhooks/kie-image`

## 7. 数据库集成

### 7.1 任务表结构

```sql
CREATE TABLE ai_tasks (
  task_no TEXT PRIMARY KEY,
  task_id TEXT,                    -- KIE AI返回的任务ID
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,            -- pending, running, succeeded, failed
  provider TEXT NOT NULL,          -- kie_4o, kie_kontext
  request_param TEXT,              -- 请求参数JSON
  result_data TEXT,                -- 结果数据JSON
  result_url TEXT,                 -- 结果图片URL
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  estimated_start_at DATETIME,
  input_params TEXT,
  ext TEXT,
  aspect TEXT,
  fail_reason TEXT
);
```

### 7.2 任务状态流转

```
pending → running → succeeded/failed
   ↑         ↑           ↑
   |         |           |
创建任务   启动任务    完成/失败
```

## 8. 错误处理

### 8.1 API错误处理

```typescript
if (!response.ok || json.code !== 200) {
  throw {
    code: json.code ?? response.status,
    message: json.msg ?? response.statusText,
    data: json ? json.data : json,
  };
}
```

### 8.2 任务失败处理

```typescript
// GPT-4o任务失败
if (result.status === "CREATE_TASK_FAILED" || result.status === "GENERATE_FAILED") {
  const [newTask] = await updateAiTask(task.task_no, {
    status: "failed",
    completed_at: new Date(),
    fail_reason: result.errorMessage,
    result_data: result,
  });
}

// Kontext任务失败
if (result.successFlag === 2 || result.successFlag === 3) {
  const [newTask] = await updateAiTask(task.task_no, {
    status: "failed",
    completed_at: new Date(),
    fail_reason: result.errorMessage,
    result_data: result,
  });
}
```

## 9. 使用示例

### 9.1 创建AI发型变换任务

```typescript
// 创建任务
const result = await createAiHairstyle({
  photo: uploadedFile,
  hair_color: { name: "棕色", value: "#8B4513" },
  hairstyle: [{ name: "短发", cover: "style_url" }],
  detail: "自然",
  type: "gpt-4o"
}, user);

// 启动任务
for (const task of result.tasks) {
  await startTask(task.task_no);
}
```

### 9.2 查询任务状态

```typescript
// 查询并更新任务状态
const { task, progress } = await updateTaskStatus(taskNo);

console.log(`任务状态: ${task.status}`);
console.log(`进度: ${progress * 100}%`);

if (task.status === "succeeded") {
  console.log(`结果URL: ${task.result_url}`);
}
```

## 10. 最佳实践

### 10.1 性能优化

1. **批量处理**: 同时创建多个任务，提高处理效率
2. **异步处理**: 使用webhook回调，避免轮询
3. **结果缓存**: 将生成结果下载到R2存储，提高访问速度

### 10.2 错误处理

1. **重试机制**: 对于网络错误，实现自动重试
2. **超时处理**: 设置合理的请求超时时间
3. **降级策略**: 当一个模型不可用时，自动切换到备用模型

### 10.3 安全考虑

1. **API密钥保护**: 将API密钥存储在环境变量中
2. **回调验证**: 验证webhook回调的签名（如果KIE AI支持）
3. **输入验证**: 对用户输入进行严格验证

## 11. 监控和日志

### 11.1 关键指标监控

- API调用成功率
- 任务完成率
- 平均处理时间
- 错误率统计

### 11.2 日志记录

```typescript
// 记录API调用
console.log('KIE AI API调用', {
  endpoint: path,
  method,
  taskId: result.taskId,
  timestamp: new Date().toISOString()
});

// 记录任务状态变更
console.log('任务状态更新', {
  taskNo: task.task_no,
  oldStatus: task.status,
  newStatus: 'running',
  provider: task.provider
});
```

## 12. 故障排查

### 12.1 常见问题

1. **API密钥无效**
   - 检查环境变量配置
   - 确认密钥是否过期

2. **回调URL不可达**
   - 检查域名配置
   - 确认防火墙设置

3. **任务长时间pending**
   - 检查estimated_start_at时间
   - 确认任务启动逻辑

### 12.2 调试工具

```typescript
// 调试模式下的详细日志
if (import.meta.env.DEV) {
  console.log('KIE AI请求参数:', params);
  console.log('KIE AI响应结果:', result);
}
```

---

## 总结

KIE AI API的接入实现采用了模块化设计，通过封装统一的客户端类，支持多种AI模型的图像生成任务。系统具备完整的任务生命周期管理、错误处理和状态监控能力，能够满足生产环境的稳定性和性能要求。

通过webhook回调机制实现异步任务处理，避免了频繁轮询带来的性能问题。同时，结合Cloudflare的基础设施，提供了高可用性和全球化的服务能力。