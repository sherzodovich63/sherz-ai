// src/nlu/memoryTypes.js

/**
 * Ruxsat etilgan memory key'lar ro'yxati.
 * Kerak bo'lsa, keyin yana qo'shamiz.
 */
export const MEMORY_KEYS = [
  "favorite_food",
  "favorite_drink",
  "wake_time",
  "sleep_time",
  "favorite_music",
  "favorite_artist",
  "favorite_person",
  "home_city",
  "work_schedule",
  "interest",
  "like",
  "dislike",
  "goal",
  "fear",
  "birthday",
];

/**
 * @typedef {(
 *  "favorite_food"    |
 *  "favorite_drink"   |
 *  "wake_time"        |
 *  "sleep_time"       |
 *  "favorite_music"   |
 *  "favorite_artist"  |
 *  "favorite_person"  |
 *  "home_city"        |
 *  "work_schedule"    |
 *  "interest"         |
 *  "like"             |
 *  "dislike"          |
 *  "goal"             |
 *  "fear"             |
 *  "birthday"
 * )} MemoryFieldKey
 */

/**
 * @typedef {Object} MemoryFact
 * @property {MemoryFieldKey} key
 * @property {string} value
 * @property {number} confidence  // 0.0 - 1.0
 * @property {"user_message"} source
 * @property {string} sourceText
 */

/**
 * @typedef {Object} MemoryNluResult
 * @property {MemoryFact[]} facts
 */
