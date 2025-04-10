// src/services/transcriptionService.ts
import fs from 'fs/promises';
import path from 'path';
import { isNodeError } from '../utils/helpers'; // Relative
import config from '../config'; // Relative

// Simulate transcription - Replace with actual external API call or local model execution
export const transcribeAudio = async (filePath: string): Promise<string> => {
  console.log(`[TranscriptionService] Simulating transcription for file: ${path.basename(filePath)} at ${filePath}`);

  // Basic check if file exists before proceeding
  try {
    await fs.access(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.error(`[TranscriptionService] Audio file not found at path: ${filePath}`);
      throw new Error(`Audio file not found.`); // User-friendly error
    }
    console.error(`[TranscriptionService] Error accessing audio file ${filePath}:`, error);
    throw error; // Re-throw other access errors
  }

  // Simulate processing time (e.g., 2-5 seconds)
  const simulationTime = 2000 + Math.random() * 3000;
  console.log(`[TranscriptionService] Simulation duration: ${simulationTime.toFixed(0)}ms`);
  await new Promise(resolve => setTimeout(resolve, simulationTime));

  // Simulate potential failure (e.g., 10% chance)
  if (Math.random() < 0.1) {
    console.error('[TranscriptionService] Simulated transcription failed.');
    throw new Error('Simulated transcription process failed. Please try again.'); // User-friendly error
  }

  // --- Generate Dummy Transcript Content ---
  // Use file info or basic placeholders in the dummy content
  const fileName = path.basename(filePath);
  // You could potentially extract metadata passed during upload if needed here,
  // but for simulation, filename is often sufficient.

  const dummyTranscription = `Therapist: Okay, let's begin. This is the simulated transcription for the file named "${fileName}". What brings you in today, or what's been on your mind since our last session?\n\nPatient: Well, things have been a bit up and down. I tried implementing that technique we discussed, the one about reframing negative thoughts.\n\nTherapist: That's good to hear you tried it. How did that go? Can you give me an example of a situation where you applied it?\n\nPatient: Yeah, on Tuesday morning, I received an email from my boss that seemed a bit critical. My initial reaction was strong anxiety, thinking I'd messed something up badly.\n\nTherapist: Okay, a common trigger. What happened next when you tried to reframe?\n\nPatient: I paused, took a breath like you suggested, and tried to look at the email more objectively. I told myself it might just be standard feedback, not necessarily a disaster. It helped a bit, reduced the immediate panic, but the worry lingered.\n\nTherapist: Reducing the immediate panic is a significant step. The lingering worry is something we can definitely explore further. It sounds like you successfully interrupted the automatic negative spiral, even if it didn't eliminate all discomfort. That's progress.\n\n(End of simulated transcription for ${fileName})`;

  console.log(`[TranscriptionService] Simulation complete for: ${fileName}`);
  return dummyTranscription;
};

// deleteUploadedFile moved to fileService.ts
