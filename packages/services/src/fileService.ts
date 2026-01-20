import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { isNodeError } from './helpers.js';

let uploadsDir: string | null = null;

export function configureFileService(dir: string) {
  uploadsDir = dir;
}

const getUploadsDir = (): string => {
  if (!uploadsDir) {
    throw new Error(
      'File service not configured. Call configureFileService() first.'
    );
  }
  return uploadsDir;
};

const generateUniqueAudioFilename = (
  sessionId: number,
  originalFilename: string
): string => {
  const timestamp = Date.now();
  const extension = path.extname(originalFilename).toLowerCase();
  const safeSessionId = String(sessionId).replace(/[^a-z0-9]/gi, '_');
  const safeExtension = extension.replace(/[^a-z0-9.]/gi, '');
  return `${safeSessionId}-${timestamp}${safeExtension}`;
};

export const saveUploadedAudio = async (
  sessionId: number,
  originalFilename: string,
  audioBuffer: Buffer
): Promise<string> => {
  const dir = getUploadsDir();
  const uniqueFilename = generateUniqueAudioFilename(
    sessionId,
    originalFilename
  );
  const absoluteFilePath = path.join(dir, uniqueFilename);
  const relativeFilePath = uniqueFilename;

  console.log(
    `[FileService] Saving audio for session ${sessionId}: ${originalFilename} -> ${absoluteFilePath}`
  );
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absoluteFilePath, audioBuffer);
    console.log(
      `[FileService] Audio saved successfully to: ${absoluteFilePath}`
    );
    return relativeFilePath;
  } catch (error) {
    console.error(
      `[FileService] Error saving uploaded audio file for session ${sessionId} (${uniqueFilename}):`,
      error
    );
    throw new Error(
      `Could not save uploaded audio file for session ${sessionId}.`
    );
  }
};

const getAudioAbsolutePath = (
  relativeFilename: string | null
): string | null => {
  const dir = getUploadsDir();
  if (!relativeFilename) return null;
  if (path.isAbsolute(relativeFilename)) {
    console.error(
      `[FileService:getAudioAbsolutePath] Received absolute path '${relativeFilename}' when expecting relative. Returning null.`
    );
    return null;
  }
  const absolutePath = path.resolve(dir, relativeFilename);
  const resolvedUploadsDir = path.resolve(dir);
  if (!absolutePath.startsWith(resolvedUploadsDir)) {
    console.error(
      `[FileService:getAudioAbsolutePath] Resolved path '${absolutePath}' is outside of expected uploads directory '${resolvedUploadsDir}'. Aborting.`
    );
    return null;
  }
  return absolutePath;
};

export const deleteUploadedAudioFile = async (
  relativeAudioIdentifier: string | null
): Promise<void> => {
  const absoluteFilePath = getAudioAbsolutePath(relativeAudioIdentifier);

  if (!absoluteFilePath) {
    console.warn(
      `[FileService] deleteUploadedAudioFile called with null or invalid relative identifier: ${relativeAudioIdentifier}. Skipping deletion.`
    );
    return;
  }

  console.log(
    `[FileService] Attempting to delete uploaded audio file: ${absoluteFilePath}`
  );
  try {
    await fs.unlink(absoluteFilePath);
    console.log(
      `[FileService] Deleted uploaded audio file: ${absoluteFilePath}`
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.warn(
        `[FileService] Uploaded audio file not found during delete: ${absoluteFilePath}`
      );
    } else {
      console.error(
        `[FileService] Error deleting uploaded audio file ${absoluteFilePath}:`,
        error
      );
      throw new Error(
        `Could not delete uploaded audio file ${absoluteFilePath}.`
      );
    }
  }
};

export const deleteAllUploads = async (): Promise<void> => {
  const dir = getUploadsDir();
  console.warn(`[FileService] DELETING ALL UPLOADS in ${dir}`);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    console.log(`[FileService] Uploads directory has been cleared.`);
  } catch (error) {
    console.error(`[FileService] Error clearing uploads directory:`, error);
    throw new Error('Failed to clear uploads directory.');
  }
};

export const copyAllUploadsTo = async (
  destinationDir: string
): Promise<void> => {
  const dir = getUploadsDir();
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const sourcePath = path.join(dir, file);
      const destPath = path.join(destinationDir, file);
      await fs.copyFile(sourcePath, destPath);
    }
    console.log(
      `[FileService] Copied ${files.length} files from ${dir} to ${destinationDir}`
    );
  } catch (error) {
    console.error(`[FileService] Error copying uploaded files:`, error);
    throw new Error('Failed to copy uploaded files for backup.');
  }
};

export { getAudioAbsolutePath, getUploadsDir };
