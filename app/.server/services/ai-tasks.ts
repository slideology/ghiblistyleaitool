// AI任务管理服务 - 核心业务逻辑模块
// 负责处理AI发型变换任务的创建、启动、状态更新等功能

import { env } from "cloudflare:workers";

import { nanoid } from "nanoid"; // 用于生成唯一ID
import currency from "currency.js"; // 用于处理数值计算

import type { CreateAiHairstyleDTO } from "~/.server/schema/task";

// 数据库操作相关导入
import {
  insertAiTaskBatch, // 批量插入AI任务
  getAiTaskByTaskNo, // 根据任务编号获取任务
  updateAiTask, // 更新AI任务
  getAiTaskByTaskId, // 根据任务ID获取任务
} from "~/.server/model/ai_tasks";
import type { InsertAiTask, AiTask, User } from "~/.server/libs/db";
import { consumptionsCredits } from "./credits"; // 积分消费服务
import { uploadFiles, downloadFilesToBucket } from "./r2-bucket"; // R2存储服务

// KIE AI服务SDK导入
import {
  KieAI,
  type CreateKontextOptions, // Kontext模型任务创建参数
  type Create4oTaskOptions, // GPT-4o模型任务创建参数
} from "~/.server/aisdk";

// 提示词生成器导入
import { createAiHairstyleChangerPrompt } from "~/.server/prompt/ai-hairstyle"; // GPT-4o提示词生成器
import { createAiHairstyleChangerPrompt as createHairstyleChangerKontext } from "~/.server/prompt/ai-hairstyle-kontext"; // Kontext提示词生成器

// AI任务结果类型定义 - 从完整任务对象中提取关键字段
export type AiTaskResult = Pick<
  AiTask,
  | "task_no" // 任务编号
  | "task_id" // AI服务返回的任务ID
  | "created_at" // 创建时间
  | "status" // 任务状态
  | "completed_at" // 完成时间
  | "aspect" // 图片宽高比
  | "result_url" // 结果图片URL
  | "fail_reason" // 失败原因
  | "ext" // 扩展信息
>;

/**
 * 转换任务对象为结果对象
 * 从完整的任务数据中提取前端需要的关键信息
 * @param value 完整的AI任务对象
 * @returns 精简的任务结果对象
 */
const transformResult = (value: AiTask): AiTaskResult => {
  const {
    task_no,
    task_id,
    created_at,
    status,
    completed_at,
    aspect,
    result_url,
    fail_reason,
    ext,
  } = value;

  return {
    task_no,
    task_id,
    created_at,
    status,
    completed_at,
    aspect,
    result_url,
    fail_reason,
    ext,
  };
};

/**
 * 创建AI任务
 * 支持单个任务或批量任务创建
 * @param payload 单个任务数据或任务数据数组
 * @returns 创建成功的任务结果数组
 */
export const createAiTask = async (payload: InsertAiTask | InsertAiTask[]) => {
  // 统一处理为数组格式，支持单个和批量创建
  const values = Array.isArray(payload) ? Array.from(payload) : [payload];
  // 批量插入数据库
  const results = await insertAiTaskBatch(values);

  // 转换为前端需要的格式并返回
  return results.map(transformResult);
};

/**
 * 创建AI发型变换任务
 * 这是核心业务函数，处理用户的发型变换请求
 * @param value 发型变换请求数据
 * @param user 用户信息
 * @returns 创建的任务列表和积分消费记录
 */
export const createAiHairstyle = async (
  value: CreateAiHairstyleDTO,
  user: User
) => {
  const { photo, hair_color, hairstyle, detail, type } = value;

  // 计算所需积分：每个发型变换消耗1个积分
  const taskCredits = hairstyle.length;

  // 扣除用户积分，确保用户有足够积分进行任务
  const consumptionResult = await consumptionsCredits(user, {
    credits: taskCredits,
  });

  // 处理用户上传的照片
  const extName = photo.name.split(".").pop()!; // 获取文件扩展名
  const newFileName = `${nanoid()}.${extName}`; // 生成唯一文件名
  const file = new File([photo], newFileName);
  const [R2Object] = await uploadFiles(file); // 上传到R2存储桶

  // 生成CDN访问URL
  const fileUrl = new URL(R2Object.key, env.CDN_URL).toString();

  // 根据AI模型类型创建不同的任务配置
  let insertPayloads: InsertAiTask[] = [];
  
  if (type === "gpt-4o") {
    // GPT-4o模型配置
    const aspect = "2:3"; // 图片宽高比设置为2:3
    const callbakUrl = new URL("/webhooks/kie-image", env.DOMAIN).toString(); // Webhook回调URL

    // 为每个选择的发型创建一个任务
    insertPayloads = hairstyle.map<InsertAiTask>((style) => {
      // 输入参数：用户的原始请求数据
      const inputParams = {
        photo: fileUrl,
        hair_color,
        hairstyle: style,
        detail,
      };
      
      // 扩展信息：用于前端显示和任务追踪
      const ext = {
        hairstyle: style.name,
        haircolor: hair_color.value ? hair_color.name : undefined,
      };

      // 构建文件URL数组：包含用户照片和参考图片
      const filesUrl = [fileUrl]; // 用户上传的照片
      if (style.cover) filesUrl.push(style.cover); // 发型参考图
      if (hair_color.cover) filesUrl.push(hair_color.cover); // 发色参考图

      // GPT-4o任务参数配置
      const params: Create4oTaskOptions = {
        filesUrl: filesUrl,
        prompt: createAiHairstyleChangerPrompt({
          hairstyle: style.name,
          haircolor: hair_color.name,
          haircolorHex: hair_color.value,
          withStyleReference: !!style.cover, // 是否有发型参考图
          withColorReference: !!hair_color.cover, // 是否有发色参考图
          detail: detail,
        }),
        size: aspect,
        nVariants: "1", // 生成4个变体（但只使用第一个）
        callBackUrl: import.meta.env.PROD ? callbakUrl : undefined, // 生产环境才设置回调
      };

      // 返回数据库插入格式的任务数据
      return {
        user_id: user.id,
        status: "pending", // 初始状态为待处理
        estimated_start_at: new Date(), // 预计开始时间
        input_params: inputParams,
        ext,
        aspect: aspect,
        provider: "kie_4o", // AI服务提供商
        request_param: params, // 发送给AI服务的参数
      };
    });
  } else if (type === "kontext") {
    // Kontext模型配置
    const aspect = "3:4"; // 图片宽高比设置为3:4
    const callbakUrl = new URL("/webhooks/kie-image", env.DOMAIN).toString(); // Webhook回调URL

    // 为每个选择的发型创建一个任务
    insertPayloads = hairstyle.map<InsertAiTask>((style) => {
      // 输入参数：用户的原始请求数据
      const inputParams = {
        photo: fileUrl,
        hair_color,
        hairstyle: style,
        detail,
      };
      
      // 扩展信息：用于前端显示和任务追踪
      const ext = {
        hairstyle: style.name,
        haircolor: hair_color.value ? hair_color.name : undefined,
      };

      // 构建文件URL数组：包含用户照片和参考图片
      const filesUrl = [fileUrl]; // 用户上传的照片
      if (style.cover) filesUrl.push(style.cover); // 发型参考图
      if (hair_color.cover) filesUrl.push(hair_color.cover); // 发色参考图

      // Kontext任务参数配置
      const params: CreateKontextOptions = {
        inputImage: fileUrl, // 输入图片URL
        prompt: createHairstyleChangerKontext({
          hairstyle: style.name,
          haircolor: hair_color.name,
          detail: detail,
        }),
        aspectRatio: aspect,
        model: "flux-kontext-pro", // 使用Kontext Pro模型
        outputFormat: "png", // 输出格式为PNG
        callBackUrl: import.meta.env.PROD ? callbakUrl : undefined, // 生产环境才设置回调
      };

      // 返回数据库插入格式的任务数据
      return {
        user_id: user.id,
        status: "pending", // 初始状态为待处理
        estimated_start_at: new Date(), // 预计开始时间
        input_params: inputParams,
        ext,
        aspect: aspect,
        provider: "kie_kontext", // AI服务提供商
        request_param: params, // 发送给AI服务的参数
      };
    });
  }

  // 批量创建任务并返回结果
  const tasks = await createAiTask(insertPayloads);
  return { tasks, consumptionCredits: consumptionResult };
};

/**
 * 启动AI任务
 * 将pending状态的任务提交给AI服务提供商开始处理
 * @param params 任务编号或任务对象
 * @returns 更新后的任务结果
 */
export const startTask = async (params: AiTask["task_no"] | AiTask) => {
  // 获取任务对象
  let task: AiTask;
  if (typeof params === "string") {
    // 如果传入的是任务编号，从数据库获取任务详情
    const result = await getAiTaskByTaskNo(params);
    if (!result) throw Error("Unvalid Task No");
    task = result;
  } else task = params; // 如果传入的是任务对象，直接使用

  // 验证任务状态：只有pending状态的任务才能启动
  if (task.status !== "pending") {
    throw Error("Task is not in Pending");
  }

  // 验证启动时间：检查是否到了预定的开始时间
  const startAt = task.estimated_start_at.valueOf();
  if (startAt > new Date().valueOf()) {
    throw Error("Not Allow to Start");
  }

  // 初始化KIE AI客户端
  const kie = new KieAI();
  let newTask: AiTask;
  
  if (task.provider === "kie_4o") {
    // 处理GPT-4o任务
    const result = await kie.create4oTask(
      task.request_param as Create4oTaskOptions
    );
    // 更新任务状态为运行中，并记录AI服务返回的任务ID
    const res = await updateAiTask(task.task_no, {
      task_id: result.taskId, // AI服务返回的任务ID
      status: "running", // 状态更新为运行中
      started_at: new Date(), // 记录实际开始时间
    });
    newTask = res[0];
  } else if (task.provider === "kie_kontext") {
    // 处理Kontext任务
    const result = await kie.createKontextTask(
      task.request_param as CreateKontextOptions
    );
    // 更新任务状态为运行中，并记录AI服务返回的任务ID
    const res = await updateAiTask(task.task_no, {
      task_id: result.taskId, // AI服务返回的任务ID
      status: "running", // 状态更新为运行中
      started_at: new Date(), // 记录实际开始时间
    });
    newTask = res[0];
  } else {
    throw Error("Unvalid Task Provider");
  }

  return transformResult(newTask);
};

/**
 * 更新AI任务状态
 * 这是核心的任务状态管理函数，根据当前状态执行不同的处理逻辑
 * - pending: 尝试启动任务
 * - running: 查询AI服务获取最新状态和进度
 * - 其他状态: 直接返回任务信息
 * @param taskNo 任务编号或任务对象
 * @returns 包含任务信息和进度的对象
 */
export const updateTaskStatus = async (taskNo: AiTask["task_no"] | AiTask) => {
  // 获取任务对象
  let task: AiTask | undefined | null;
  if (typeof taskNo === "string") {
    task = await getAiTaskByTaskNo(taskNo);
  } else task = taskNo;

  if (!task) throw Error("Unvalid Task No");
  
  // 处理pending状态：尝试启动任务
  if (task.status === "pending") {
    try {
      const result = await startTask(task);
      return {
        task: result,
        progress: 0, // 刚启动，进度为0
      };
    } catch {
      // 启动失败，返回原任务状态
      return { task: transformResult(task), progress: 0 };
    }
  }
  
  // 处理非running状态：任务已完成或失败
  if (task.status !== "running") {
    return {
      task: transformResult(task),
      progress: 1, // 已完成，进度为100%
    };
  }

  // 验证任务ID：running状态的任务必须有AI服务的任务ID
  if (!task.task_id) throw Error("Unvalid Task ID");

  // 初始化KIE AI客户端
  const kie = new KieAI();

  if (task.provider === "kie_4o") {
    // 处理GPT-4o任务状态查询
    const result = await kie.query4oTaskDetail({ taskId: task.task_id });
    
    if (result.status === "GENERATING") {
      // 任务正在生成中，返回当前进度
      return {
        task: transformResult(task),
        progress: currency(result.progress).intValue, // 将进度转换为整数
      };
    } else if (result.status === "SUCCESS") {
      // 任务成功完成，处理结果
      let resultUrl = result.response?.resultUrls[0]; // 获取第一个结果URL（虽然生成了4个，但只使用第一个）
      let newTask: AiTask;
      
      if (!resultUrl) {
        // 没有获取到结果URL，标记任务失败
        const [aiTask] = await updateAiTask(task.task_no, {
          status: "failed",
          completed_at: new Date(),
          result_data: result,
          result_url: resultUrl,
          fail_reason: "Result url not retrieved", // 失败原因：未获取到结果URL
        });
        newTask = aiTask;
      } else {
        // 生产环境下，将结果图片下载到自己的R2存储桶
        if (import.meta.env.PROD) {
          try {
            const [file] = await downloadFilesToBucket(
              [{ src: resultUrl, fileName: task.task_no, ext: "png" }],
              "result/hairstyle" // 存储到结果目录
            );
            if (file) resultUrl = new URL(file.key, env.CDN_URL).toString(); // 使用自己的CDN URL
          } catch {}
        }

        // 更新任务为成功状态
        const [aiTask] = await updateAiTask(task.task_no, {
          status: "succeeded",
          completed_at: new Date(),
          result_data: result, // 保存AI服务返回的完整数据
          result_url: resultUrl, // 保存结果图片URL
        });
        newTask = aiTask;
      }

      return { task: transformResult(newTask), progress: 1 };
    } else {
      // 任务失败，更新失败状态
      const [newTask] = await updateAiTask(task.task_no, {
        status: "failed",
        completed_at: new Date(),
        fail_reason: result.errorMessage, // 保存失败原因
        result_data: result,
      });

      return { task: transformResult(newTask), progress: 1 };
    }
  } else if (task.provider === "kie_kontext") {
    // 处理Kontext任务状态查询
    const result = await kie.queryKontextTask({ taskId: task.task_id });
    
    if (result.successFlag === 0) {
      // 任务还在处理中
      return {
        task: transformResult(task),
        progress: 0, // Kontext模型不提供具体进度，处理中时进度为0
      };
    } else if (result.successFlag === 1) {
      // 任务成功完成，处理结果
      let resultUrl =
        result.response?.resultImageUrl ?? result.response?.originImageUrl; // 优先使用结果图片，备选原图片
      let newTask: AiTask;
      
      if (!resultUrl) {
        // 没有获取到结果URL，标记任务失败
        const [aiTask] = await updateAiTask(task.task_no, {
          status: "failed",
          completed_at: new Date(),
          result_data: result,
          result_url: resultUrl,
          fail_reason: "Result url not retrieved", // 失败原因：未获取到结果URL
        });
        newTask = aiTask;
      } else {
        // 生产环境下，将结果图片下载到自己的R2存储桶
        if (import.meta.env.PROD) {
          try {
            const [file] = await downloadFilesToBucket(
              [{ src: resultUrl, fileName: task.task_no, ext: "png" }],
              "result/hairstyle" // 存储到结果目录
            );
            if (file) resultUrl = new URL(file.key, env.CDN_URL).toString(); // 使用自己的CDN URL
          } catch {}
        }

        // 更新任务为成功状态
        const [aiTask] = await updateAiTask(task.task_no, {
          status: "succeeded",
          completed_at: new Date(),
          result_data: result, // 保存AI服务返回的完整数据
          result_url: resultUrl, // 保存结果图片URL
        });
        newTask = aiTask;
      }

      return { task: transformResult(newTask), progress: 1 };
    } else {
      // 任务失败，更新失败状态
      const [newTask] = await updateAiTask(task.task_no, {
        status: "failed",
        completed_at: new Date(),
        fail_reason: result.errorMessage, // 保存失败原因
        result_data: result,
      });

      return { task: transformResult(newTask), progress: 1 };
    }
  }

  // 默认返回（理论上不应该到达这里）
  return {
    task: transformResult(task),
    progress: 1,
  };
};

/**
 * 根据AI服务的任务ID更新任务状态
 * 主要用于Webhook回调时根据AI服务的任务ID找到对应的本地任务并更新状态
 * @param taskId AI服务返回的任务ID
 */
export const updateTaskStatusByTaskId = async (taskId: AiTask["task_id"]) => {
  // 根据AI服务的任务ID查找本地任务
  const result = await getAiTaskByTaskId(taskId);
  if (!result || result.status !== "running") {
    throw Error("Unvalid Task ID");
  }

  // 更新任务状态
  await updateTaskStatus(result);
};
