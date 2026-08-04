// validators/schemas.js
import Joi from 'joi';

// 🔑 Login uchun schema
export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required()
});

// 📅 Reminder yaratish uchun schema
export const reminderCreateSchema = Joi.object({
  title: Joi.string().min(3).max(100).required(),
  notes: Joi.string().allow('', null),
  channel: Joi.string().default('local'),
  dueAt: Joi.date().iso().required()
});

// 📒 Fact create schema
export const factCreateSchema = Joi.object({
  userId: Joi.string().required(),
  key: Joi.string().min(2).required(),
  value: Joi.string().min(1).required(),
  type: Joi.string().valid('habit', 'feedback', 'learning', 'note').default('note'),
  time: Joi.date().iso().optional(),
  rating: Joi.number().min(-1).max(1).optional()
});
