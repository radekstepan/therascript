// packages/ui/src/hooks/useAnimatedText.tsx
// Dependencies: npm i framer-motion (run in packages/ui)

'use client'; // Ensure this is treated as a client component

import { animate } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';

const delimiter = ''; // Animate character-by-character

export function useAnimatedText(text: string, enabled: boolean = true) {
  const [animatedText, setAnimatedText] = useState('');
  const controlsRef = useRef<ReturnType<typeof animate> | null>(null);
  const cursorRef = useRef(0); // Use ref to track cursor across renders/restarts
  const prevTextRef = useRef(text);
  const startingCursorRef = useRef(0); // Use ref to avoid state update races

  // Effect to handle text updates and trigger animation
  useEffect(() => {
    if (!enabled) {
      setAnimatedText(text); // If disabled, just show the full text
      return;
    }

    const prevText = prevTextRef.current;
    let startCursor = 0;

    // --- Interruption Logic ---
    // If the new text starts with the previous fully animated text,
    // continue from where the previous animation left off.
    // Otherwise, restart from the beginning.
    if (text.startsWith(prevText)) {
      startCursor = prevText.split(delimiter).length;
      // console.log(`Continuing animation from cursor: ${startCursor}`);
    } else {
      // console.log(`Restarting animation from cursor: 0`);
      startCursor = 0;
      setAnimatedText(''); // Reset displayed text on full restart
    }
    startingCursorRef.current = startCursor;
    prevTextRef.current = text; // Update previous text reference *after* comparison

    // Stop any previous animation controller
    controlsRef.current?.stop();

    // Calculate target length based on delimiters
    const targetLength = text.split(delimiter).length;

    // Calculate duration based on the number of new characters/words to animate
    // Adjust the 'charsPerSecond' value to control speed
    const charsPerSecond = 60; // Adjust speed here (e.g., 60 chars/sec)
    const newChars = targetLength - startingCursorRef.current;
    const calculatedDuration = Math.max(0.1, newChars / charsPerSecond); // Minimum duration 0.1s

    // console.log(`Starting animation: from ${startingCursorRef.current} to ${targetLength}, duration: ${calculatedDuration.toFixed(2)}s`);

    // Start the new animation
    controlsRef.current = animate(
      startingCursorRef.current, // Animate from the determined starting point
      targetLength,
      {
        duration: calculatedDuration,
        ease: 'linear', // Use linear for constant speed
        onUpdate(latest) {
          cursorRef.current = Math.floor(latest);
          setAnimatedText(
            text.split(delimiter).slice(0, cursorRef.current).join(delimiter)
          );
        },
        onComplete() {
          // console.log("Animation complete");
          setAnimatedText(text); // Ensure full text is displayed on completion
          prevTextRef.current = text; // Ensure prevText matches final text
        },
      }
    );

    // Cleanup function to stop animation on unmount or dependency change
    return () => {
      // console.log("Stopping animation controls");
      controlsRef.current?.stop();
    };
  }, [text, enabled]); // Rerun effect if text or enabled status changes

  return animatedText;
}
