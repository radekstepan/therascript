// packages/ui/src/api/templates.ts
import axios from 'axios';
import type { Template } from '../types';

export const fetchTemplates = async (): Promise<Template[]> => {
  const response = await axios.get<Template[]>('/api/templates');
  return response.data;
};

export const createTemplate = async (data: {
  title: string;
  text: string;
}): Promise<Template> => {
  const response = await axios.post<Template>('/api/templates', data);
  return response.data;
};

export const updateTemplate = async (
  id: number,
  data: { title: string; text: string }
): Promise<Template> => {
  const response = await axios.put<Template>(`/api/templates/${id}`, data);
  return response.data;
};

export const deleteTemplate = async (
  id: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/templates/${id}`);
  return response.data;
};
