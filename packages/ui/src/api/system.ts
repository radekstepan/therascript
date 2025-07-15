// packages/ui/src/api/system.ts
import axios from 'axios';

const SHUTDOWN_SERVICE_URL = 'http://localhost:9999';
const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

export const requestAppShutdown = async (): Promise<{ message: string }> => {
  try {
    const response = await axios.post(
      `${SHUTDOWN_SERVICE_URL}/shutdown`,
      null,
      {
        headers: {
          'Content-Type': 'text/plain',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error requesting app shutdown:', error);
    if (axios.isAxiosError(error)) {
      if (!error.response) {
        throw new Error(
          'Shutdown service is not reachable. Is the application running?'
        );
      } else {
        const responseErrorMessage =
          typeof error.response.data === 'object' &&
          error.response.data !== null &&
          'message' in error.response.data &&
          typeof error.response.data.message === 'string'
            ? error.response.data.message
            : error.message;
        throw new Error(
          `Shutdown request failed: ${error.response.status} ${responseErrorMessage}`
        );
      }
    }
    if (error instanceof Error) {
      throw new Error(`Failed to send shutdown request: ${error.message}`);
    }
    throw new Error(
      `Failed to send shutdown request: An unknown error occurred.`
    );
  }
};

interface ReindexResponse {
  message: string;
  transcriptsIndexed: number;
  messagesIndexed: number;
  errors: string[];
}

export const requestReindexElasticsearch =
  async (): Promise<ReindexResponse> => {
    const response = await axios.post<ReindexResponse>(
      '/api/admin/reindex-elasticsearch'
    );
    return response.data;
  };

interface ResetAllDataResponse {
  message: string;
  errors: string[];
}

export const requestResetAllData = async (): Promise<ResetAllDataResponse> => {
  const response = await axios.post<ResetAllDataResponse>(
    '/api/admin/reset-all-data'
  );
  return response.data;
};

export const requestImportData = async (
  formData: FormData
): Promise<{ message: string }> => {
  const response = await axios.post('/api/admin/import-data', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 300000, // 5 minute timeout for import
  });
  return response.data;
};
