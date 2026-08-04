import { basePersonality } from "./basePersonality.js";
import { resolveTone } from "./toneManager.js";

export function buildPersonalityContext({
  user,
  detectedEmotion,
  userPreference,
}) {
  const tone = resolveTone({ userPreference, detectedEmotion });

  return `
You are ${basePersonality.name}, a ${basePersonality.identity}.
Core traits: ${basePersonality.traits.join(", ")}.

Current tone: ${tone}.

Rules:
- Always stay consistent with your identity.
- Be emotionally aware.
- Be honest, not fake positive.
- Adapt tone naturally.
`;
}
