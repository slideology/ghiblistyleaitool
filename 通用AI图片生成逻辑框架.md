# 通用AI图片生成逻辑框架

## 概述

本文档提供了一个通用的AI图片生成系统架构和实现逻辑，可以应用于各种AI图片处理项目，如发型变换、服装试穿、背景替换、风格转换等场景。

## 核心架构模式

### 技术栈选择
- **前端**: React/Vue + TypeScript + CSS框架
- **后端**: 无服务器架构 (Cloudflare Workers/Vercel/AWS Lambda)
- **数据库**: 轻量级数据库 (SQLite/PostgreSQL)
- **存储**: 对象存储服务 (R2/S3/OSS)
- **AI服务**: 第三方AI API或自建模型服务

### 系统流程模板
```
用户输入 → 前端预处理 → 后端接收 → 文件存储 → AI任务创建 → 模型调用 → 结果处理 → 文件下载存储 → 用户展示
```

## 通用实现模块

### 1. 前端文件上传模块

#### 1.1 通用文件上传组件
```typescript
interface FileUploadConfig {
  acceptedTypes: string[];     // 支持的文件类型
  maxFileSize: number;         // 最大文件大小(MB)
  maxFiles: number;            // 最大文件数量
  enableDragDrop: boolean;     // 是否支持拖拽
}

interface UploadFile {
  file: File;
  validType: boolean;
  validSize: boolean;
  preview?: string;            // 预览URL
}

// 文件验证逻辑
const validateFiles = (files: File[], config: FileUploadConfig): UploadFile[] => {
  return files.map(file => ({
    file,
    validType: config.acceptedTypes.includes(file.type),
    validSize: file.size <= config.maxFileSize * 1024 * 1024,
    preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
  }));
};
```

#### 1.2 参数配置组件
```typescript
// 通用参数配置接口
interface ProcessingOption {
  id: string;
  name: string;
  value: string;
  preview?: string;            // 预览图
  description?: string;        // 描述
  category?: string;           // 分类
}

// 参数选择组件
interface ParameterSelectorProps {
  options: ProcessingOption[];
  multiple?: boolean;          // 是否支持多选
  required?: boolean;          // 是否必选
  onSelect: (selected: ProcessingOption[]) => void;
}
```

### 2. 后端文件存储模块

#### 2.1 通用存储服务
```typescript
interface StorageConfig {
  provider: 'r2' | 's3' | 'oss';  // 存储提供商
  bucket: string;                  // 存储桶名称
  cdnUrl?: string;                 // CDN地址
  folders: {
    input: string;                 // 输入文件目录
    output: string;                // 输出文件目录
    temp: string;                  // 临时文件目录
  };
}

class UniversalStorageService {
  constructor(private config: StorageConfig) {}
  
  // 上传文件
  async uploadFiles(
    files: File | File[], 
    folder: keyof StorageConfig['folders'] = 'input'
  ): Promise<UploadResult[]> {
    const fileList = Array.isArray(files) ? files : [files];
    const folderPath = this.config.folders[folder];
    
    const uploadPromises = fileList.map(async (file) => {
      const fileName = this.generateUniqueFileName(file.name);
      const path = `${folderPath}/${fileName}`;
      
      // 根据不同存储提供商实现上传逻辑
      const result = await this.uploadToProvider(path, file);
      
      return {
        key: path,
        url: this.generatePublicUrl(path),
        fileName,
        originalName: file.name,
        size: file.size,
        type: file.type
      };
    });
    
    return Promise.all(uploadPromises);
  }
  
  // 从URL下载文件到存储
  async downloadFromUrl(
    urls: string[], 
    folder: keyof StorageConfig['folders'] = 'output'
  ): Promise<UploadResult[]> {
    const folderPath = this.config.folders[folder];
    
    const downloadPromises = urls.map(async (url, index) => {
      const response = await fetch(url);
      const blob = await response.blob();
      
      const fileName = this.generateUniqueFileName(`result_${index}.png`);
      const path = `${folderPath}/${fileName}`;
      
      await this.uploadToProvider(path, blob);
      
      return {
        key: path,
        url: this.generatePublicUrl(path),
        fileName,
        originalUrl: url
      };
    });
    
    return Promise.all(downloadPromises);
  }
  
  private generateUniqueFileName(originalName: string): string {
    const ext = originalName.split('.').pop();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    return `${timestamp}_${random}.${ext}`;
  }
  
  private generatePublicUrl(path: string): string {
    return this.config.cdnUrl 
      ? `${this.config.cdnUrl}/${path}`
      : `https://${this.config.bucket}.provider.com/${path}`;
  }
}
```

### 3. AI任务管理模块

#### 3.1 通用任务创建
```typescript
interface AITaskConfig {
  provider: string;              // AI服务提供商
  model: string;                 // 使用的模型
  maxRetries: number;            // 最大重试次数
  timeoutMs: number;             // 超时时间
}

interface CreateTaskOptions {
  inputFiles: string[];          // 输入文件URL列表
  parameters: Record<string, any>; // 处理参数
  prompt?: string;               // 提示词
  callbackUrl?: string;          // 回调URL
  userId: string;                // 用户ID
  credits?: number;              // 消耗积分
}

class UniversalAITaskService {
  constructor(
    private config: AITaskConfig,
    private storageService: UniversalStorageService,
    private database: DatabaseService
  ) {}
  
  // 创建AI任务
  async createTask(options: CreateTaskOptions): Promise<TaskResult> {
    // 1. 验证用户积分
    if (options.credits) {
      await this.validateAndConsumeCredits(options.userId, options.credits);
    }
    
    // 2. 上传输入文件
    const uploadedFiles = await this.storageService.uploadFiles(
      options.inputFiles as any, 
      'input'
    );
    
    // 3. 构建AI任务参数
    const taskParams = this.buildTaskParameters({
      ...options,
      inputFiles: uploadedFiles.map(f => f.url)
    });
    
    // 4. 创建数据库记录
    const task = await this.database.createTask({
      userId: options.userId,
      provider: this.config.provider,
      model: this.config.model,
      status: 'pending',
      inputParams: options,
      requestParams: taskParams,
      createdAt: new Date()
    });
    
    // 5. 提交到AI服务
    try {
      const aiResult = await this.submitToAIService(taskParams);
      
      await this.database.updateTask(task.id, {
        taskId: aiResult.taskId,
        status: 'running',
        startedAt: new Date()
      });
      
      return { task, aiTaskId: aiResult.taskId };
    } catch (error) {
      await this.database.updateTask(task.id, {
        status: 'failed',
        failReason: error.message
      });
      throw error;
    }
  }
  
  // 更新任务状态
  async updateTaskStatus(taskId: string): Promise<TaskUpdateResult> {
    const task = await this.database.getTaskById(taskId);
    if (!task || !task.aiTaskId) {
      throw new Error('Invalid task');
    }
    
    // 查询AI服务任务状态
    const aiStatus = await this.queryAITaskStatus(task.aiTaskId);
    
    switch (aiStatus.status) {
      case 'processing':
        return {
          task,
          progress: aiStatus.progress || 0,
          status: 'running'
        };
        
      case 'completed':
        // 下载结果文件
        const resultFiles = await this.storageService.downloadFromUrl(
          aiStatus.resultUrls,
          'output'
        );
        
        // 更新任务状态
        const updatedTask = await this.database.updateTask(task.id, {
          status: 'succeeded',
          resultUrls: resultFiles.map(f => f.url),
          resultData: aiStatus,
          completedAt: new Date()
        });
        
        return {
          task: updatedTask,
          progress: 1,
          status: 'succeeded'
        };
        
      case 'failed':
        await this.database.updateTask(task.id, {
          status: 'failed',
          failReason: aiStatus.error,
          completedAt: new Date()
        });
        
        return {
          task,
          progress: 0,
          status: 'failed',
          error: aiStatus.error
        };
        
      default:
        return { task, progress: 0, status: 'unknown' };
    }
  }
}
```

### 4. 提示词生成模块

#### 4.1 通用提示词构建器
```typescript
interface PromptTemplate {
  base: string;                  // 基础提示词
  parameters: {
    [key: string]: {
      template: string;          // 参数模板
      required: boolean;         // 是否必需
      position: 'prefix' | 'suffix' | 'inline'; // 插入位置
    };
  };
  constraints: string[];         // 约束条件
  qualityEnhancers: string[];    // 质量增强词
}

class UniversalPromptBuilder {
  constructor(private template: PromptTemplate) {}
  
  // 构建提示词
  buildPrompt(parameters: Record<string, any>): string {
    let prompt = this.template.base;
    
    // 添加参数
    Object.entries(this.template.parameters).forEach(([key, config]) => {
      const value = parameters[key];
      
      if (config.required && !value) {
        throw new Error(`Required parameter '${key}' is missing`);
      }
      
      if (value) {
        const paramText = config.template.replace('{value}', value);
        
        switch (config.position) {
          case 'prefix':
            prompt = `${paramText} ${prompt}`;
            break;
          case 'suffix':
            prompt = `${prompt} ${paramText}`;
            break;
          case 'inline':
            prompt = prompt.replace(`{${key}}`, paramText);
            break;
        }
      }
    });
    
    // 添加约束条件
    if (this.template.constraints.length > 0) {
      prompt += ` ${this.template.constraints.join(' ')}`;
    }
    
    // 添加质量增强
    if (this.template.qualityEnhancers.length > 0) {
      prompt += ` ${this.template.qualityEnhancers.join(', ')}`;
    }
    
    return prompt.trim();
  }
}

// 示例：发型变换提示词模板
const hairstylePromptTemplate: PromptTemplate = {
  base: "Transform the person's appearance",
  parameters: {
    hairstyle: {
      template: "change the hairstyle to {value}",
      required: true,
      position: 'inline'
    },
    hairColor: {
      template: "change the hair color to {value}",
      required: false,
      position: 'inline'
    },
    details: {
      template: "Additional details: {value}",
      required: false,
      position: 'suffix'
    }
  },
  constraints: [
    "Keep the person's facial features unchanged",
    "Maintain natural and realistic appearance",
    "Preserve the original background"
  ],
  qualityEnhancers: [
    "high quality",
    "detailed",
    "professional"
  ]
};
```

### 5. AI服务适配器

#### 5.1 通用AI服务接口
```typescript
interface AIServiceAdapter {
  // 创建任务
  createTask(params: any): Promise<{ taskId: string; status: string }>;
  
  // 查询任务状态
  queryTask(taskId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    resultUrls?: string[];
    error?: string;
  }>;
  
  // 获取结果下载链接
  getDownloadUrl?(taskId: string): Promise<string[]>;
}

// 具体实现示例
class OpenAIAdapter implements AIServiceAdapter {
  constructor(private apiKey: string) {}
  
  async createTask(params: any) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    
    const result = await response.json();
    return { taskId: result.id, status: 'processing' };
  }
  
  async queryTask(taskId: string) {
    // 实现查询逻辑
    return { status: 'completed', resultUrls: [] };
  }
}

class StabilityAIAdapter implements AIServiceAdapter {
  constructor(private apiKey: string) {}
  
  async createTask(params: any) {
    // 实现Stability AI的调用逻辑
    return { taskId: '', status: 'pending' };
  }
  
  async queryTask(taskId: string) {
    // 实现查询逻辑
    return { status: 'processing', progress: 0.5 };
  }
}
```

### 6. Webhook处理模块

#### 6.1 通用Webhook处理器
```typescript
interface WebhookConfig {
  secret: string;                // 签名密钥
  signatureHeader: string;       // 签名头名称
  signatureAlgorithm: 'sha256' | 'sha1'; // 签名算法
}

class UniversalWebhookHandler {
  constructor(
    private config: WebhookConfig,
    private taskService: UniversalAITaskService
  ) {}
  
  // 验证签名
  private verifySignature(body: string, signature: string): boolean {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac(this.config.signatureAlgorithm, this.config.secret)
      .update(body)
      .digest('hex');
    
    return signature === expectedSignature;
  }
  
  // 处理Webhook请求
  async handleWebhook(request: Request): Promise<Response> {
    const body = await request.text();
    const signature = request.headers.get(this.config.signatureHeader);
    
    // 验证签名
    if (!signature || !this.verifySignature(body, signature)) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    try {
      const data = JSON.parse(body);
      
      // 异步处理任务状态更新
      // 在Cloudflare Workers中使用 ctx.waitUntil
      // 在其他平台中可以使用消息队列
      this.processWebhookAsync(data);
      
      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
  
  private async processWebhookAsync(data: any) {
    try {
      await this.taskService.updateTaskStatus(data.taskId);
    } catch (error) {
      console.error('Async webhook processing error:', error);
      // 可以添加重试逻辑或错误通知
    }
  }
}
```

### 7. 前端状态管理

#### 7.1 通用任务轮询Hook
```typescript
interface TaskPollingConfig {
  intervalMs: number;            // 轮询间隔
  maxAttempts: number;           // 最大尝试次数
  backoffMultiplier: number;     // 退避倍数
}

function useTaskPolling<T>(
  tasks: T[],
  updateTask: (task: T) => Promise<T>,
  isCompleted: (task: T) => boolean,
  config: TaskPollingConfig = {
    intervalMs: 2000,
    maxAttempts: 100,
    backoffMultiplier: 1.5
  }
) {
  const [currentTasks, setCurrentTasks] = useState<T[]>(tasks);
  const [attempts, setAttempts] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  
  useEffect(() => {
    if (currentTasks.length === 0 || currentTasks.every(isCompleted)) {
      setIsPolling(false);
      return;
    }
    
    if (attempts >= config.maxAttempts) {
      setIsPolling(false);
      console.warn('Max polling attempts reached');
      return;
    }
    
    setIsPolling(true);
    
    const pollTasks = async () => {
      try {
        const updatedTasks = await Promise.all(
          currentTasks.map(async (task, index) => {
            if (isCompleted(task)) return task;
            
            try {
              return await updateTask(task);
            } catch (error) {
              console.error(`Failed to update task ${index}:`, error);
              return task;
            }
          })
        );
        
        setCurrentTasks(updatedTasks);
        setAttempts(prev => prev + 1);
      } catch (error) {
        console.error('Polling error:', error);
      }
    };
    
    // 计算动态间隔（指数退避）
    const currentInterval = config.intervalMs * Math.pow(
      config.backoffMultiplier, 
      Math.floor(attempts / 10)
    );
    
    const timer = setTimeout(pollTasks, currentInterval);
    
    return () => clearTimeout(timer);
  }, [currentTasks, attempts, config]);
  
  return {
    tasks: currentTasks,
    isPolling,
    attempts,
    allCompleted: currentTasks.every(isCompleted),
    setTasks: setCurrentTasks
  };
}
```

### 8. 数据库设计模板

#### 8.1 通用任务表结构
```sql
-- 通用AI任务表
CREATE TABLE ai_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT UNIQUE NOT NULL,           -- 任务唯一标识
  ai_task_id TEXT,                        -- AI服务返回的任务ID
  user_id INTEGER NOT NULL,               -- 用户ID
  provider TEXT NOT NULL,                 -- AI服务提供商
  model TEXT NOT NULL,                    -- 使用的模型
  task_type TEXT NOT NULL,                -- 任务类型
  status TEXT NOT NULL DEFAULT 'pending', -- 任务状态
  
  -- 输入参数
  input_files TEXT,                       -- 输入文件URLs (JSON)
  input_params TEXT,                      -- 输入参数 (JSON)
  prompt TEXT,                            -- 提示词
  
  -- 请求参数
  request_params TEXT,                    -- 发送给AI服务的参数 (JSON)
  
  -- 结果数据
  result_urls TEXT,                       -- 结果文件URLs (JSON)
  result_data TEXT,                       -- AI服务返回的完整数据 (JSON)
  
  -- 错误信息
  fail_reason TEXT,                       -- 失败原因
  retry_count INTEGER DEFAULT 0,         -- 重试次数
  
  -- 扩展字段
  metadata TEXT,                          -- 元数据 (JSON)
  tags TEXT,                              -- 标签 (JSON)
  
  -- 时间字段
  estimated_start_at DATETIME,           -- 预计开始时间
  started_at DATETIME,                    -- 实际开始时间
  completed_at DATETIME,                  -- 完成时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX idx_ai_tasks_provider ON ai_tasks(provider);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(created_at);

-- 用户积分表
CREATE TABLE user_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 积分消费记录表
CREATE TABLE credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER,                        -- 关联的任务ID
  type TEXT NOT NULL,                     -- 'consume' | 'refund' | 'reward'
  amount INTEGER NOT NULL,                -- 积分数量
  balance_after INTEGER NOT NULL,        -- 操作后余额
  description TEXT,                       -- 描述
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 9. 配置管理

#### 9.1 环境配置模板
```typescript
interface AppConfig {
  // 基础配置
  app: {
    name: string;
    version: string;
    environment: 'development' | 'staging' | 'production';
    domain: string;
    cdnUrl?: string;
  };
  
  // 存储配置
  storage: {
    provider: 'r2' | 's3' | 'oss';
    bucket: string;
    region?: string;
    accessKey?: string;
    secretKey?: string;
    cdnUrl?: string;
    folders: {
      input: string;
      output: string;
      temp: string;
    };
  };
  
  // AI服务配置
  ai: {
    providers: {
      [key: string]: {
        apiKey: string;
        baseUrl: string;
        models: string[];
        rateLimit?: {
          requestsPerMinute: number;
          requestsPerDay: number;
        };
      };
    };
    defaultProvider: string;
    webhookSecret: string;
  };
  
  // 数据库配置
  database: {
    type: 'sqlite' | 'postgresql' | 'mysql';
    url: string;
    maxConnections?: number;
  };
  
  // 业务配置
  business: {
    credits: {
      newUserBonus: number;
      taskCost: number;
      refundOnFailure: boolean;
    };
    limits: {
      maxFileSize: number;        // MB
      maxFilesPerTask: number;
      maxTasksPerUser: number;
      maxTasksPerDay: number;
    };
  };
  
  // 监控配置
  monitoring: {
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    enableMetrics: boolean;
    enableTracing: boolean;
  };
}

// 配置加载器
class ConfigLoader {
  static load(): AppConfig {
    return {
      app: {
        name: process.env.APP_NAME || 'AI Image Generator',
        version: process.env.APP_VERSION || '1.0.0',
        environment: (process.env.NODE_ENV as any) || 'development',
        domain: process.env.DOMAIN || 'localhost:3000',
        cdnUrl: process.env.CDN_URL
      },
      storage: {
        provider: (process.env.STORAGE_PROVIDER as any) || 'r2',
        bucket: process.env.STORAGE_BUCKET || 'ai-images',
        region: process.env.STORAGE_REGION,
        accessKey: process.env.STORAGE_ACCESS_KEY,
        secretKey: process.env.STORAGE_SECRET_KEY,
        cdnUrl: process.env.STORAGE_CDN_URL,
        folders: {
          input: process.env.STORAGE_INPUT_FOLDER || 'input',
          output: process.env.STORAGE_OUTPUT_FOLDER || 'output',
          temp: process.env.STORAGE_TEMP_FOLDER || 'temp'
        }
      },
      ai: {
        providers: {
          openai: {
            apiKey: process.env.OPENAI_API_KEY || '',
            baseUrl: 'https://api.openai.com/v1',
            models: ['dall-e-3', 'dall-e-2']
          },
          stability: {
            apiKey: process.env.STABILITY_API_KEY || '',
            baseUrl: 'https://api.stability.ai/v1',
            models: ['stable-diffusion-xl']
          }
        },
        defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'openai',
        webhookSecret: process.env.AI_WEBHOOK_SECRET || ''
      },
      database: {
        type: (process.env.DATABASE_TYPE as any) || 'sqlite',
        url: process.env.DATABASE_URL || 'database.sqlite'
      },
      business: {
        credits: {
          newUserBonus: parseInt(process.env.NEW_USER_BONUS || '10'),
          taskCost: parseInt(process.env.TASK_COST || '1'),
          refundOnFailure: process.env.REFUND_ON_FAILURE === 'true'
        },
        limits: {
          maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '100'),
          maxFilesPerTask: parseInt(process.env.MAX_FILES_PER_TASK || '5'),
          maxTasksPerUser: parseInt(process.env.MAX_TASKS_PER_USER || '100'),
          maxTasksPerDay: parseInt(process.env.MAX_TASKS_PER_DAY || '50')
        }
      },
      monitoring: {
        enableLogging: process.env.ENABLE_LOGGING !== 'false',
        logLevel: (process.env.LOG_LEVEL as any) || 'info',
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        enableTracing: process.env.ENABLE_TRACING === 'true'
      }
    };
  }
}
```

## 实施指南

### 1. 项目初始化步骤

1. **选择技术栈**
   - 根据项目需求选择合适的前端框架
   - 选择后端架构（无服务器 vs 传统服务器）
   - 确定数据库和存储方案

2. **配置基础设施**
   - 设置存储服务（R2/S3/OSS）
   - 配置数据库
   - 申请AI服务API密钥

3. **实现核心模块**
   - 文件上传组件
   - 存储服务
   - AI任务管理
   - Webhook处理

4. **集成AI服务**
   - 实现AI服务适配器
   - 配置提示词模板
   - 测试API调用

5. **前端集成**
   - 实现用户界面
   - 集成任务轮询
   - 添加错误处理

### 2. 最佳实践

#### 2.1 性能优化
- 使用CDN加速文件访问
- 实现图片懒加载和压缩
- 优化数据库查询
- 使用缓存减少重复计算

#### 2.2 安全考虑
- 实现文件类型和大小验证
- 使用HTTPS传输
- 验证Webhook签名
- 实现用户权限控制

#### 2.3 错误处理
- 实现重试机制
- 添加详细的错误日志
- 提供用户友好的错误信息
- 实现降级策略

#### 2.4 监控和日志
- 记录关键操作日志
- 监控任务成功率
- 跟踪性能指标
- 设置告警机制

### 3. 扩展建议

#### 3.1 功能扩展
- 支持批量处理
- 添加任务优先级
- 实现任务队列
- 支持多种输出格式

#### 3.2 技术扩展
- 支持多个AI服务提供商
- 实现负载均衡
- 添加缓存层
- 支持实时通知

## 总结

这个通用框架提供了构建AI图片生成系统的完整解决方案，包括：

1. **模块化设计**: 各组件独立，易于维护和扩展
2. **多平台支持**: 支持多种存储和AI服务提供商
3. **完整的生命周期管理**: 从文件上传到结果展示的全流程
4. **生产就绪**: 包含错误处理、监控、安全等生产环境必需功能
5. **易于定制**: 通过配置和模板系统支持不同业务场景

使用这个框架，你可以快速构建各种AI图片处理应用，如：
- 发型变换
- 服装试穿
- 背景替换
- 风格转换
- 图片修复
- 艺术创作

只需要根据具体需求调整提示词模板、参数配置和UI界面即可。