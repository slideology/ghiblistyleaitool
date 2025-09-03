import React from "react";

interface WsrvParams {
  [key: string]: string | number | boolean | undefined;
}

interface ImageProps extends React.ComponentProps<"img"> {
  proxy?: boolean; // 是否使用 wsrv.nl 代理
  wsrv?: WsrvParams; // 传入 wsrv.nl 的参数
}

/**
 * Image 组件
 * 功能：
 * - 可选通过 wsrv.nl 对远程图片进行代理（例如压缩、裁剪等）。
 * - 当代理拉取失败（例如源站需要鉴权或拒绝爬取）时，自动回退为原始图片地址，避免显示占位错误图。
 * 使用说明：
 * - 通过 `proxy` 开关控制是否走 wsrv.nl，默认开启。
 * - 通过 `wsrv` 传入额外的处理参数（如 w/h/fit 等）。
 */
export const Image = ({ src, proxy = true, wsrv, onError, ...props }: ImageProps) => {
  let finalSrc = src;

  // 如果传入了 src 这个字段，就进入这个判断流程
  if (finalSrc) {
    const isRemote = typeof src === "string" && /^https:\/\//.test(src);

    if (proxy && isRemote) {
      const url = new URL("https://wsrv.nl/");
      url.searchParams.set("url", src!);

      if (wsrv) {
        for (const [key, value] of Object.entries(wsrv)) {
          if (value !== undefined) {
            url.searchParams.set(key, String(value));
          }
        }
      }

      finalSrc = url.toString();
    }
  }

  // 图片加载失败时的回退处理：如果是 wsrv 代理失败，则回退到原始 src，避免反复触发
  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    try {
      const img = e.currentTarget;
      const isWsrv = typeof finalSrc === "string" && finalSrc.startsWith("https://wsrv.nl/");
      const canFallback = proxy && typeof src === "string" && src.length > 0;
      const alreadyFallback = img.dataset.wsrvFallbackApplied === "true";

      if (isWsrv && canFallback && !alreadyFallback) {
        img.dataset.wsrvFallbackApplied = "true";
        img.src = src as string; // 回退为原始地址
        return; // 阻止向上传递，避免用户 onError 也再次处理
      }
    } catch {}

    // 若无法回退，调用外部自定义 onError（如果存在）
    if (onError) onError(e);
  };

  return <img src={finalSrc as string | undefined} onError={handleError} {...props} />;
};