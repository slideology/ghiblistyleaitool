import clsx from "clsx";

export type AIModelType = "gpt-4o" | "kontext";

export interface AIModel {
  id: AIModelType;
  name: string;
}

// AI模型配置
export const AI_MODELS: AIModel[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o"
  },
  {
    id: "kontext",
    name: "Flux Kontext"
  }
];

interface AIModelSelectorProps {
  selectedModel: AIModelType;
  onModelChange: (model: AIModelType) => void;
  className?: string;
}

/**
 * AI模型选择器组件
 * 允许用户在不同的AI模型之间进行选择
 */
export const AIModelSelector = ({
  selectedModel,
  onModelChange,
  className
}: AIModelSelectorProps) => {
  return (
    <div className={clsx("space-y-3", className)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {AI_MODELS.map((model) => {
          const isSelected = selectedModel === model.id;
          
          return (
            <div
              key={model.id}
              className={clsx(
                "cursor-pointer p-3 rounded-lg border-2 transition-all duration-200",
                "hover:shadow-md text-center",
                isSelected
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-base-300 bg-base-100 hover:border-primary/50"
              )}
              onClick={() => onModelChange(model.id)}
            >
              <div className="flex items-center justify-center space-x-2">
                <h3 className="font-semibold text-sm">{model.name}</h3>
                {isSelected && (
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};