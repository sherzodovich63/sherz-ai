// src/brain/todoService.js

/**
 * Todo qo‘shish
 */
export async function addTodo(prisma, userId, text) {
  const todo = await prisma.todo.create({
    data: {
      userId,
      text,
      done: false, // default holatda bajarilmagan
    },
  });

  return todo;
}

/**
 * Todo ro‘yxatini olish
 *
 * includeDone = true bo‘lsa — hammasi (done bo‘lganlari ham),
 * includeDone = false bo‘lsa — faqat bajarilmaganlari
 */
export async function listTodos(
  prisma,
  userId,
  { includeDone = false, limit = 20 } = {}
) {
  const todos = await prisma.todo.findMany({
    where: {
      userId,
      ...(includeDone ? {} : { done: false }),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  return todos;
}

/**
 * Todo ni bajarildi deb belgilash
 */
export async function completeTodo(prisma, userId, id, done = true) {
  const todo = await prisma.todo.update({
    where: { id }, // id unique
    data: { done },
  });

  return todo;
}

/**
 * Todo matnini yangilash
 */
export async function updateTodo(prisma, userId, id, newText) {
  const text = (newText || '').toString().trim();
  if (!text) {
    throw new Error('EMPTY_TEXT');
  }

  const todo = await prisma.todo.update({
    where: { id }, // oddiy holatda id bo‘yicha yangilaymiz
    data: { text },
  });

  return todo;
}

/**
 * Todo ni o‘chirish
 */
export async function deleteTodo(prisma, userId, id) {
  // deleteMany ishlatyapmiz: userId bo‘yicha ham filtrlasa xavfsizroq
  const result = await prisma.todo.deleteMany({
    where: {
      id,
      userId,
    },
  });

  return {
    deletedCount: result.count,
  };
}
