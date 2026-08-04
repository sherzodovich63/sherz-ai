export function resolveTone({ userPreference, detectedEmotion }) {
  if (userPreference?.tone) return userPreference.tone;

  if (detectedEmotion === "sad") return "comfort";
  if (detectedEmotion === "stressed") return "calm";
  if (detectedEmotion === "happy") return "energetic";

  return "friendly";
}
