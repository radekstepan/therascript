import fs from 'node:fs/promises';
import path from 'node:path';
import { isNodeError } from '../utils/helpers.js';

// TODO use the whisper Docker API
export const transcribeAudio = async (filePath: string): Promise<string> => {
  console.log(`[TranscriptionService] Simulating transcription for: ${path.basename(filePath)}`);

  try { await fs.access(filePath); }
  catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') throw new Error(`Audio file not found.`);
    throw error;
  }

  const simulationTime = 1500 + Math.random() * 2500;
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
