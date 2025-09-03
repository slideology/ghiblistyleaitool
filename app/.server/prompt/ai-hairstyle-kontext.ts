// Kontext模型发型变换提示词生成器的参数接口
interface CreateAiHairstyleChangerPromptOptions {
  hairstyle: string; // 目标发型名称
  haircolor?: string; // 目标发色名称（可选）
  detail?: string; // 用户的特殊要求或详细说明（可选）
}
/**
 * 为Kontext模型创建发型变换的AI提示词
 * 该函数为Kontext模型生成简洁有效的发型变换指令
 * @param options 提示词生成参数
 * @returns 格式化的提示词字符串
 */
export const createAiHairstyleChangerPrompt = ({
  hairstyle,
  haircolor,
  detail,
}: CreateAiHairstyleChangerPromptOptions) => {
  // 初始化提示词数组，用于构建完整的AI指令
  const prompt: string[] = [];
  
  // 根据是否指定发色来构建基础变换指令
  if (haircolor) {
    // 如果用户指定了发色，同时变换发型和发色
    prompt.push(
      `Change the current hairstyle to a ${hairstyle} with ${haircolor} hair color.`
    );
  } else {
    // 如果用户没有指定发色，只变换发型，保持原有发色
    prompt.push(
      `Change the current hairstyle to a ${hairstyle} and keep the person hair color.`
    );
  }

  // 添加重要的约束条件，确保只变换发型而不影响其他部分
  prompt.push(
    "Maintain the rest of the image the same, and do not modify the background or the proportions of the character's body." // 保持图片其他部分不变，包括背景和身体比例
  );

  // 如果用户提供了特殊要求，添加到提示词中
  if (detail) {
    prompt.push(`Other ideas about how to edit my image: ${detail}`);
  }

  // 将所有提示词片段用换行符连接成完整的指令
  return prompt.join("\n");
};
