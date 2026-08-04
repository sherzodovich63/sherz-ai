// src/llm/openaiClient.js
import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY topilmadi. Iltimos .env faylga qo‘shing.');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});
