// =========================================
// File: packages/api/src/services/fileService.ts
// =========================================
import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto'; // Import crypto for unique name generation
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';

const uploadsDir = config.db.uploadsDir;

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
  const uniqueFilename = generateUniqueAudioFilename(
    sessionId,
    originalFilename
  );
  const absoluteFilePath = path.join(uploadsDir, uniqueFilename);
  const relativeFilePath = uniqueFilename;

  console.log(
    `[FileService] Saving audio for session ${sessionId}: ${originalFilename} -> ${absoluteFilePath}`
  );
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
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
  if (!relativeFilename) return null;
  if (path.isAbsolute(relativeFilename)) {
    console.error(
      `[FileService:getAudioAbsolutePath] Received absolute path '${relativeFilename}' when expecting relative. Returning null.`
    );
    return null;
  }
  const absolutePath = path.resolve(uploadsDir, relativeFilename);
  const resolvedUploadsDir = path.resolve(uploadsDir);
  if (!absolutePath.startsWith(resolvedUploadsDir)) {
    console.error(
      `[FileService:getAudioAbsolutePath] Resolved path '${absolutePath}' is outside the expected uploads directory '${resolvedUploadsDir}'. Aborting.`
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
  console.warn(`[FileService] DELETING ALL UPLOADS in ${uploadsDir}`);
  try {
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log(`[FileService] Uploads directory has been cleared.`);
  } catch (error) {
    console.error(`[FileService] Error clearing uploads directory:`, error);
    throw new Error('Failed to clear uploads directory.');
  }
};

export const getUploadsDir = (): string => {
  return uploadsDir;
};

export const copyAllUploadsTo = async (
  destinationDir: string
): Promise<void> => {
  try {
    const files = await fs.readdir(uploadsDir);
    for (const file of files) {
      const sourcePath = path.join(uploadsDir, file);
      const destPath = path.join(destinationDir, file);
      await fs.copyFile(sourcePath, destPath);
    }
    console.log(
      `[FileService] Copied ${files.length} files from ${uploadsDir} to ${destinationDir}`
    );
  } catch (error) {
    console.error(`[FileService] Error copying uploaded files:`, error);
    throw new Error('Failed to copy uploaded files for backup.');
  }
};

export { getAudioAbsolutePath };
