// GPT-4o模型发型变换提示词生成器的参数接口
interface CreateAiHairstyleChangerPromptOptions {
  hairstyle: string; // 目标发型名称
  haircolor?: string; // 目标发色名称（可选）
  haircolorHex?: string; // 发色的十六进制颜色值（可选）
  withStyleReference?: boolean; // 是否使用发型参考图片（可选）
  withColorReference?: boolean; // 是否使用发色参考图片（可选）
  detail?: string; // 用户的特殊要求或详细说明（可选）
}
/**
 * 为GPT-4o模型创建发型变换的AI提示词
 * 该函数根据用户选择的发型、发色和参考图片生成详细的AI指令
 * @param options 提示词生成参数
 * @returns 格式化的提示词字符串
 */
export const createAiHairstyleChangerPrompt = ({
  hairstyle,
  haircolor,
  haircolorHex,
  withStyleReference,
  withColorReference,
  detail,
}: CreateAiHairstyleChangerPromptOptions) => {
  // 初始化提示词数组，用于构建完整的AI指令
  const prompt: string[] = [];
  
  // 根据是否指定发色来构建基础变换指令
  if (haircolor) {
    // 如果用户指定了发色，同时变换发型和发色
    prompt.push(
      `Change the current hairstyle to a ${hairstyle} with ${haircolor} hair color${
        haircolorHex ? ` (hex: ${haircolorHex}).` : "."
      }`
    );
  } else {
    // 如果用户没有指定发色，只变换发型，保持原有发色和肤色
    prompt.push(
      `Change the current hairstyle to a ${hairstyle} and keep the person hair color and skin tone.`
    );
  }

  // 处理发型参考图片的说明
  if (withStyleReference) {
    prompt.push(
      "Use the second image attachment as the hairstyle reference. The first image attachment is the original photo of the user."
    );
  }
  
  // 处理发色参考图片的说明，需要根据是否有发型参考图来确定图片顺序
  if (withColorReference) {
    if (withStyleReference) {
      // 如果同时有发型和发色参考图：第一张是用户照片，第二张是发型参考，第三张是发色参考
      prompt.push("Use the third image attachment as a color reference");
    } else {
      // 如果只有发色参考图：第一张是用户照片，第二张是发色参考
      prompt.push(
        "Use the second image attachment as a hair color reference. The first image attachment is the original photo of the user."
      );
    }
  }

  // 添加重要的约束条件，确保AI生成高质量且符合要求的结果
  prompt.push(
    "Keep the person's face, facial features, and expression exactly the same.", // 保持面部特征不变
    "The new hairstyle should look natural and realistic, blending seamlessly with the original lighting and photo style." // 确保效果自然真实
  );

  // 如果用户提供了特殊要求，添加到提示词中
  if (detail) {
    prompt.push("", "Special Requests", detail);
  }

  // 将所有提示词片段用换行符连接成完整的指令
  return prompt.join("\n");
};
