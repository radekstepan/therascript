export interface LlmModelPricing {
  promptCostPer1M: number;
  completionCostPer1M: number;
}

export interface WhisperModelPricing {
  costPerMinute: number;
}

export interface PricingConfig {
  llm: Record<string, LlmModelPricing>;
  whisper: Record<string, WhisperModelPricing>;
}

export const pricing: PricingConfig = {
  llm: {
    'gemma3:4b': { promptCostPer1M: 0.01703, completionCostPer1M: 0.06815 },
    'gemma3:12b': { promptCostPer1M: 0.03, completionCostPer1M: 0.1 },
    default: { promptCostPer1M: 0.15, completionCostPer1M: 0.6 },
  },
  whisper: {
    large: { costPerMinute: 0.006 },
    default: { costPerMinute: 0.006 },
  },
};
