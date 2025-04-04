// src/sampleData.ts
import type { Session } from './types';

export const SAMPLE_SESSIONS: Session[] = [
  {
    id: 1,
    fileName: "sample_session_alpha.mp3",
    clientName: "John Doe",
    sessionName: "Alpha Intro Session",
    date: "2024-03-28",
    sessionType: "individual",
    therapy: "CBT",
    transcription: `Therapist: Welcome back, John. Last week we talked about identifying some of those automatic negative thoughts when you start feeling overwhelmed at work. How did that go this past week?\n
Patient: It was... okay, I guess. I tried to catch them like we practiced. I noticed a few times, especially on Tuesday when that big deadline was looming. I kept thinking, 'I'm definitely going to mess this up,' and 'Everyone else is probably handling this better.'\n
Therapist: That's great that you were able to identify those specific thoughts. 'I'm going to mess this up' and 'Everyone else is handling this better.' Those sound like pretty common examples of catastrophic thinking and comparison, which we discussed. What happened after you noticed those thoughts?\n
Patient: Well, I tried to do the thing where you question it. Like, okay, is it *definitely* true I'll mess it up? Probably not, I've handled big deadlines before. And do I *know* everyone else is handling it better? No, I can't really know that.\n
Therapist: Excellent work challenging those thoughts. That takes practice. Did challenging them change how you felt or what you did in that moment?\n
Patient: A little bit, maybe? It didn't magically make the stress go away, but I think I felt slightly less... paralyzed? I was able to break down the next step instead of just staring at the screen feeling doomed.\n
Therapist: That 'slightly less paralyzed' feeling and being able to take the next step is actually a significant shift, John. That's the core of what we're working on – noticing the thought, evaluating it, and then choosing an action based on a more balanced perspective, even if the uncomfortable feeling is still there to some degree. It sounds like you successfully applied the technique. How did the rest of the deadline situation play out?\n
Patient: I got it done. It wasn't perfect, but it was submitted on time. I didn't get fired. (laughs nervously)\n
Therapist: Right. So the catastrophic thought, 'I'm definitely going to mess this up,' didn't come true. And you used the strategy to help you move forward despite the anxiety. That's progress. What about the thought about comparison? 'Everyone else is handling this better.' Did you try challenging that one?\n
Patient: Yeah, that one's harder. Logically, I know I can't know what's inside their heads, but it just *feels* like everyone else is cruising along while I'm struggling.\n
Therapist: That 'feeling' is powerful, isn't it? We can work more on that specific thought pattern. Sometimes, comparison comes from focusing only on others' perceived successes while minimizing our own efforts or struggles. For next week, perhaps we can focus specifically on identifying evidence for *your* competence, even small examples, when that comparison thought pops up. How does that sound?
Patient: Okay, yeah. I can try that. It still feels kind of fake sometimes, but I guess it makes sense.`,
    chats: [
      {
        id: 1700000000001,
        timestamp: Date.now() - 86400000 * 2, // 2 days ago
        messages: [
          { id: 1, sender: 'ai', text: "Loaded session: Alpha Intro Session (2024-03-28). Ask me anything." },
          { id: 2, sender: 'user', text: "Summarize the patient's main concern.", starred: true },
          { id: 3, sender: 'ai', text: "The patient, John, discussed feeling overwhelmed at work, specifically experiencing automatic negative thoughts like 'I'm going to mess this up' and comparing himself negatively to others when facing deadlines. He practiced challenging these thoughts." }
        ]
      }
    ]
  },
  {
    id: 2,
    fileName: "sample_session_beta.mp3",
    clientName: "Jane Smith",
    sessionName: "Beta DBT Check-in", // Updated name slightly
    date: "2024-03-29",
    sessionType: "phone",
    therapy: "DBT",
    transcription: `Therapist: Hi Jane, thanks for calling in for our phone session. How have things been since we last spoke?\n
Patient: Hi. Uh, it's been rough. That argument I mentioned with my sister happened again on Saturday.\n
Therapist: Okay, I'm sorry to hear it was rough. Can you walk me through what happened during the argument on Saturday? Let's use the chain analysis framework we practiced.\n
Patient: Right, okay. The prompting event... she criticized how I was loading the dishwasher, again. Said I was doing it all wrong.\n
Therapist: Okay, she criticized the dishwasher loading. What thoughts and feelings came up for you right then?\n
Patient: Instantly just... anger. Like, white-hot anger. And thoughts like, 'She always does this,' 'She thinks I'm stupid,' 'Why can't she just leave me alone?' And I felt this tightness in my chest, my face got hot.\n
Therapist: Anger, thoughts of being criticized and invalidated, physical sensations like heat and tightness. That sounds like a strong emotional reaction. What vulnerability factors might have been present before she even said anything?\n
Patient: Hmm. I hadn't slept well the night before, maybe only 5 hours. And I was already kind of stressed because I had a work email I needed to deal with later.\n
Therapist: Okay, so lack of sleep and pre-existing stress definitely could have lowered your tolerance level. So, feeling angry, thinking she's always critical... what action did you take then?\n
Patient: I yelled back. I said something like, 'Why are you always attacking me? Just do it yourself if you're so perfect!' And I slammed the dishwasher door shut and stormed out of the kitchen.\n
Therapist: Okay, so the action was yelling, making an accusation, slamming the door, and leaving the situation. What were the immediate consequences of that?\n
Patient: She looked shocked, maybe a little hurt. And then she got defensive and yelled back that she wasn't attacking me. I went to my room and just felt awful. Still angry, but also guilty and kind of ashamed for losing my temper like that.\n
Therapist: So, short-term relief from leaving the immediate conflict, but followed by negative feelings like guilt and shame, and the conflict wasn't resolved. What about longer-term consequences?\n
Patient: We didn't talk for the rest of the day. It was super awkward Sunday morning. It just adds to this pattern where we avoid each other after we fight.\n
Therapist: Okay, thanks for walking through that chain, Jane. It really highlights the links between the prompting event, your vulnerabilities, thoughts, feelings, actions, and consequences. Thinking back, at what point could you have used a skill differently? Where was a potential turning point?\n
Patient: Probably right when she first criticized me. Before I yelled. When I felt that anger surge.\n
Therapist: Right. And what skill could have been helpful there? We've talked about distress tolerance and emotion regulation skills.\n
Patient: Maybe... STOP? Or paced breathing? Or maybe just saying, 'Okay, I hear you think I'm doing it wrong. Can we talk about this later?' instead of yelling?\n
Therapist: Those are all excellent options. Using STOP to pause, doing some paced breathing to calm the physical sensations, or using a DEAR MAN skill for assertiveness like asking to talk later. Which one feels most achievable in that kind of moment for you, looking back?\n
Patient: The STOP skill feels like the first step. Just... not reacting instantly. Maybe if I could just pause, I could then choose one of the others.\n
Therapist: That's a great plan. Focusing on the STOP skill as the initial intervention point. Let's rehearse that. Imagine your sister makes the comment... what do you do? \n
Patient: Okay... she says it. I Stop. Take a breath, don't just react. Observe... I'm feeling angry, my chest is tight. Proceed mindfully... maybe say, 'Hey, can we pause this conversation for a minute?'\n
Therapist: Perfect. That sounds like a solid plan to practice.`,
    chats: [
      {
        id: 1700000000002,
        timestamp: Date.now() - 3600000, // 1 hour ago
        messages: [
          { id: 4, sender: 'ai', text: "Loaded session: Beta DBT Check-in (2024-03-29). How can I help?" },
          { id: 5, sender: 'user', text: "What was the prompting event for Jane's distress?", starred: false },
          { id: 6, sender: 'ai', text: "The prompting event was Jane's sister criticizing how she was loading the dishwasher."}
        ]
      },
      {
        id: 1700000000003,
        timestamp: Date.now() - 86400000, // 1 day ago
        name: "Follow-up Questions",
        messages: [
          { id: 7, sender: 'ai', text: "Previous chat log started for Beta session." },
          { id: 8, sender: 'user', text: "Identify DBT skills discussed.", starred: false},
          { id: 9, sender: 'ai', text: "The therapist and Jane discussed using Chain Analysis to understand an argument. Potential skills identified to manage the situation included STOP, paced breathing, and DEAR MAN for assertive communication."}
        ]
      }
    ]
  },
  {
    id: 3,
    fileName: "sample_session_gamma.mp3",
    clientName: "Alex Chen",
    sessionName: "Gamma Skills Group",
    date: "2024-03-30",
    sessionType: "skills group",
    therapy: "DBT Skills",
    transcription: `Facilitator: Alright everyone, let's settle in. Welcome back to the DBT Skills Group. Tonight we're continuing our module on Emotion Regulation, specifically focusing on 'Checking the Facts'. Who remembers what 'Checking the Facts' is primarily used for?\n
Participant A (Maria): Isn't it for when you feel an emotion, but you're not sure if it, like, fits the situation? Or if the intensity fits?\n
Facilitator: Exactly, Maria. It's about questioning whether our emotional reaction is justified by the actual facts of the situation, or if our interpretations or assumptions might be driving the emotion more strongly than necessary. Great start. So, let's think about an example. Has anyone had a situation this week where they felt a strong emotion and maybe later thought it didn't quite fit?\n
(Silence for a moment)\n
Participant B (Leo): I guess... I got really anxious on Thursday before that presentation at work. Like, heart pounding, convinced I was going to blank out completely.\n
Facilitator: Okay, Leo. Strong anxiety before a presentation. That's a common one. Let's try 'Checking the Facts' on that. What was the prompting event?\n
Leo: Just... knowing the presentation was happening at 2 PM.\n
Facilitator: Okay. And the emotion was anxiety, intensity sounds high – pounding heart, convinced you'd blank out. Now, what were the interpretations or thoughts running through your mind?\n
Leo: That everyone would judge me, that I wasn't prepared enough even though I practiced, that if I messed up it would be a disaster for my career.\n
Facilitator: Those are powerful interpretations: 'Everyone will judge me,' 'I'm not prepared enough,' 'It will be a disaster.' Now, let's check the facts. What's the actual evidence *for* and *against* those thoughts? Did everyone judge you in the past?\n
Leo: Well, no, not really. Most people are supportive, or at least neutral.\n
Facilitator: Okay. And were you actually unprepared? You said you practiced.\n
Leo: I did practice, quite a bit actually. I knew the material.\n
Facilitator: Fact. And has a single presentation mistake ever been a 'disaster' for your career before?\n
Leo: No, definitely not. That seems... dramatic, saying it out loud.\n
Facilitator: So, checking the facts reveals that while some baseline anxiety about presenting is understandable (it *is* a performance situation), the *intensity* of the anxiety and the catastrophic thoughts might not fully match the objective evidence. Does seeing it that way change the feeling at all, even thinking back?\n
Leo: Yeah, a little. It makes the fear seem less... solid? More like a story I was telling myself.\n
Facilitator: Exactly. It helps separate the objective event from our interpretation. Thanks for sharing that, Leo. Alex, you were quiet during check-in. Did anything resonate with you from this example or the 'Checking the Facts' skill?\n
Patient (Alex): I don't know. I just feel angry a lot. I don't think checking facts helps with that. It feels justified.\n
Facilitator: That's a really important point, Alex. Anger often *does* feel justified in the moment. Sometimes it is, sometimes it might be amplified by interpretations. Could you think of a recent time you felt angry? We don't have to go deep, just an example.\n
Alex: My roommate left dishes in the sink again yesterday. I was furious.\n
Facilitator: Okay. Prompting event: dishes in the sink. Emotion: furious. What interpretations or thoughts were linked to that anger?\n
Alex: That he's doing it on purpose to annoy me, that he has no respect for me or our shared space, that I always have to clean up after him.\n
Facilitator: 'He's doing it on purpose,' 'no respect,' 'always have to clean up.' Those are strong interpretations. Let's check the facts, just as an exercise. What's the evidence he did it *on purpose* to annoy you?\n
Alex: Well... I don't *know* for sure. He's just generally messy sometimes.\n
Facilitator: Okay. And the evidence for 'no respect'?\n
Alex: He's usually pretty considerate in other ways... just not with dishes.\n
Facilitator: And 'always' have to clean up? Is it literally every time?\n
Alex: Not *always*, no. But it feels like it.\n
Facilitator: So, the facts might be: he left dishes (again), which is frustrating and inconvenient, and perhaps violates a house agreement. But the interpretation that it's a deliberate sign of disrespect might not be fully supported by facts, especially if he's considerate otherwise. Would anger still be appropriate? Maybe. But would *fury* be the most effective emotion, or fit the facts once interpretations are questioned?\n
Alex: ...Maybe not fury. Just regular annoyed, probably.\n
Facilitator: And feeling 'regular annoyed' might lead to a different, perhaps more effective, action than feeling 'furious', right? Maybe a calmer conversation about the dishes using a skill like DEAR MAN later on, rather than an explosive reaction? Just something to think about. Thanks for sharing that, Alex. It's tough work. Let's move on to...`,
    chats: [
      {
        id: 1700000000004,
        timestamp: Date.now() - 86400000 * 3, // 3 days ago
        messages: [
          { id: 10, sender: 'ai', text: "Loaded session: Gamma Skills Group (2024-03-30)." },
          { id: 11, sender: 'user', text: "What DBT skill was the main topic of this group session?", starred: false},
          { id: 12, sender: 'ai', text: "The main DBT skill discussed was 'Checking the Facts', part of the Emotion Regulation module."}
        ]
      }
    ]
  }
];
