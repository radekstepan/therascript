import { db, get, run } from '@therascript/db';
import type { AppSettingsRow } from '@therascript/domain';

const selectSettingsSql = 'SELECT * FROM app_settings WHERE id = 1';

export const appSettingsRepository = {
  getSettings: (): AppSettingsRow => {
    try {
      const row = get<AppSettingsRow>(selectSettingsSql);
      if (!row) {
        return {
          id: 1,
          llm_base_url: null,
          llm_model_name: 'default',
          llm_context_size: null,
          llm_temperature: 0.7,
          llm_top_p: 0.9,
          llm_repeat_penalty: 1.1,
          llm_num_gpu_layers: null,
          llm_thinking_budget: null,
          llm_api_token: null,
        };
      }
      return row;
    } catch (e) {
      console.error('[AppSettingsRepo] Error fetching settings:', e);
      throw new Error('Database error fetching app settings.');
    }
  },

  updateSettings: (updates: Partial<AppSettingsRow>): void => {
    try {
      const current = appSettingsRepository.getSettings();
      const next = { ...current, ...updates };
      run(
        `UPDATE app_settings SET
          llm_base_url = ?, llm_model_name = ?, llm_context_size = ?,
          llm_temperature = ?, llm_top_p = ?, llm_repeat_penalty = ?,
          llm_num_gpu_layers = ?, llm_thinking_budget = ?,
          llm_api_token = ?
        WHERE id = 1`,
        next.llm_base_url,
        next.llm_model_name,
        next.llm_context_size,
        next.llm_temperature,
        next.llm_top_p,
        next.llm_repeat_penalty,
        next.llm_num_gpu_layers,
        next.llm_thinking_budget,
        next.llm_api_token
      );
    } catch (e) {
      console.error('[AppSettingsRepo] Error updating settings:', e);
      throw new Error('Database error updating app settings.');
    }
  },
};
