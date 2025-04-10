// src/services/transcriptionService.ts
import fs from 'fs/promises';
import path from 'path';
import { isNodeError } from '../utils/helpers.js'; // ADDED .js
import config from '../config/index.js'; // ADDED .js

export const transcribeAudio = async (filePath: string): Promise<string> => {
  console.log(`[TranscriptionService] Simulating transcription for: ${path.basename(filePath)}`);

  try { await fs.access(filePath); }
  catch (error) {
    // --- Use isNodeError ---
    if (isNodeError(error) && error.code === 'ENOENT') throw new Error(`Audio file not found.`);
    // --- End Use ---
    throw error; // Re-throw other errors
  }

  const simulationTime = 1500 + Math.random() * 2500; // Shorter simulation
  console.log(`[TranscriptionService] Simulation duration: ${simulationTime.toFixed(0)}ms`);
  await new Promise(resolve => setTimeout(resolve, simulationTime));

  if (Math.random() < 0.05) { // 5% failure chance
    console.error('[TranscriptionService] Simulated transcription failed.');
    throw new Error('Simulated transcription process failed.');
  }

  const fileName = path.basename(filePath);
  const dummyTranscription = `Therapist: Simulation start for ${fileName}. How are things?\n\nPatient: Okay, I suppose. Trying those techniques.\n\nTherapist: Good. Any specific examples?\n\nPatient: That email situation... tried the breathing. Helped a bit.\n\nTherapist: Progress! Let's explore that.\n\n(End simulation for ${fileName})`;

  console.log(`[TranscriptionService] Simulation complete for: ${fileName}`);
  return dummyTranscription;
};
