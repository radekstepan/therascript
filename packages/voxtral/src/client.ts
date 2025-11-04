import axios from 'axios';
import fs from 'fs';
import OpenAI from 'openai';

const DEFAULT_BASE_URL =
  process.env.VOXTRAL_API_URL || 'http://localhost:8010/v1';
const DEFAULT_MODEL =
  process.env.VOXTRAL_MODEL || 'mistralai/Voxtral-Mini-3B-2507';

export async function healthCheck(
  baseUrl: string = DEFAULT_BASE_URL
): Promise<boolean> {
  try {
    const url = baseUrl.replace(/\/$/, '') + '/models';
    const res = await axios.get(url, { timeout: 3000 });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function transcribeFile(
  filePath: string,
  options?: {
    language?: string;
    temperature?: number;
    baseUrl?: string;
    model?: string;
  }
): Promise<{ text: string }> {
  const baseUrl = options?.baseUrl || DEFAULT_BASE_URL;
  const model = options?.model || DEFAULT_MODEL;
  const client = new OpenAI({ apiKey: 'EMPTY', baseURL: baseUrl });

  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath) as any,
    model,
    language: options?.language || 'en',
    temperature: options?.temperature ?? 0.0,
  } as any);

  // OpenAI SDK returns either an object with 'text' or a full response depending on version
  const text = (response as any).text ?? String(response);
  return { text };
}

export async function listModels(baseUrl: string = DEFAULT_BASE_URL) {
  const client = new OpenAI({ apiKey: 'EMPTY', baseURL: baseUrl });
  const models = await client.models.list();
  return models.data.map((m) => m.id);
}
