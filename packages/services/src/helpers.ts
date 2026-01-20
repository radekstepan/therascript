import type { BackendSession } from '@therascript/domain';

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

export const cleanLlmOutput = (text: string): string => {
  const tokensToRemove = [
    '</end_of_turn>',
    '<end_of_turn>',
    '<|end_of_turn|>',
    '<|endofturn|>',
    '<|eot_id|>',
    '<|eot|>',
    '<eos>',
    '</s>',
    '<start_of_turn>user',
    '<start_of_turn>model',
    '<start_of_turn>assistant',
    '<start_of_turn>',
    '<|start_of_turn|>',
    '<|startofturn|>',
    '<|start_header_id|>',
    '<|end_header_id|>',
    '<|eom_id|>',
    '[/INST]',
    '[INST]',
    '<s>',
  ];

  let cleanedText = text;
  for (const token of tokensToRemove) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedToken, 'gi');
    cleanedText = cleanedText.replace(regex, '');
  }

  cleanedText = cleanedText
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/gm, '')
    .replace(/(\r\n|\n|\r){2,}/g, '\n')
    .trim();

  return cleanedText;
};

export const createSessionListDTO = (
  session: BackendSession
): Omit<BackendSession, 'chats'> => {
  const { chats, ...dto } = session;
  return dto;
};
