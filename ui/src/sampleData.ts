// src/sampleData.ts
import type { Session } from './types';

export const SAMPLE_SESSIONS: Session[] = [
  {
    id: 1,
    fileName: "sample_session_alpha.mp3",
    clientName: "John Doe",
    sessionName: "Alpha Intro Session",
    date: "2024-03-28", // Use current year for realism
    sessionType: "individual",
    therapy: "CBT",
    transcription: "Therapist: Welcome John. How are things? \nPatient: Things are simulated. I'm feeling quite static today. \nTherapist: Static? Tell me more about that. \nPatient: It's like... placeholder text. No real dynamic content happening. \nTherapist: I see. Let's explore that feeling of being placeholder text.",
    chats: [
      {
        id: 1700000000001,
        timestamp: Date.now() - 86400000 * 2, // 2 days ago
        messages: [
          { id: 1, sender: 'ai', text: "Loaded session: Alpha Intro Session (2024-03-28). Ask me anything." },
          { id: 2, sender: 'user', text: "Summarize the patient's main concern.", starred: true }, // Mark one as starred
          { id: 3, sender: 'ai', text: "The patient described feeling 'static', like 'placeholder text', indicating a lack of dynamic content or engagement in their experience." }
        ]
      }
    ]
  },
  {
    id: 2,
    fileName: "sample_session_beta.mp3",
    clientName: "Jane Smith",
    sessionName: "Beta Refactoring Discussion",
    date: "2024-03-29", // Use current year
    sessionType: "phone",
    therapy: "DBT",
    transcription: "Therapist: Hi Jane. This is Beta session. Any updates? \nPatient: I tried the refactoring technique. It was complex. \nTherapist: Complex in what way? \nPatient: Managing state, passing props... it felt overwhelming. \nTherapist: It's common to feel overwhelmed by complexity. Let's break it down.",
    chats: [
      {
        id: 1700000000002,
        timestamp: Date.now() - 3600000, // 1 hour ago
        messages: [
          { id: 4, sender: 'ai', text: "Loaded session: Beta Refactoring Discussion (2024-03-29). How can I help?" },
          { id: 5, sender: 'user', text: "What technique did Jane try?", starred: false },
          { id: 6, sender: 'ai', text: "Jane mentioned trying a 'refactoring technique' related to managing state and passing props, which she found complex and overwhelming."}
        ]
      },
      { // Add a second chat history example
        id: 1700000000003,
        timestamp: Date.now() - 86400000, // 1 day ago
        messages: [
          { id: 7, sender: 'ai', text: "Previous chat log started for Beta session." },
          { id: 8, sender: 'user', text: "Identify any distress tolerance skills used.", starred: false},
          { id: 9, sender: 'ai', text: "No specific distress tolerance skills were explicitly mentioned in this part of the transcript."}
        ]
      }
    ]
  },
  {
    id: 3,
    fileName: "sample_session_gamma.mp3",
    clientName: "Alex Chen",
    sessionName: "Gamma Skills Group",
    date: "2024-03-30", // Use current year
    sessionType: "skills group",
    therapy: "DBT Skills",
    transcription: "Facilitator: Okay group, let's talk about mindfulness. What did everyone practice this week?\nParticipant A: I tried the mindful breathing during my commute.\nParticipant B: I focused on observing thoughts without judgment.\nFacilitator: Excellent examples. Alex, how about you?\nPatient (Alex): I didn't really practice much...\nFacilitator: That's okay. Sometimes getting started is the hardest part. What was the barrier?",
    chats: [
      {
        id: 1700000000004,
        timestamp: Date.now() - 86400000 * 3, // 3 days ago
        messages: [
          { id: 10, sender: 'ai', text: "Loaded session: Gamma Skills Group (2024-03-30)." },
          { id: 11, sender: 'user', text: "Who is the primary patient in this session?", starred: false},
          { id: 12, sender: 'ai', text: "Based on the facilitator addressing them directly ('Alex, how about you?') and the subsequent interaction, Alex Chen appears to be the focus patient in this segment, although it's a group setting."}
        ]
      }
    ]
  }
];
