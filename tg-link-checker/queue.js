// Per-user FIFO job queue. Different users run in parallel; the same
// user's submissions are processed one-at-a-time.

const userQueues = new Map(); // userId -> { running, tasks: [] }

export function enqueue(userId, task) {
  let q = userQueues.get(userId);
  if (!q) { q = { running: false, tasks: [] }; userQueues.set(userId, q); }
  return new Promise((resolve, reject) => {
    q.tasks.push({ task, resolve, reject });
    drain(userId);
  });
}

export function pendingCount(userId) {
  const q = userQueues.get(userId);
  if (!q) return 0;
  return q.tasks.length + (q.running ? 1 : 0);
}

async function drain(userId) {
  const q = userQueues.get(userId);
  if (!q || q.running) return;
  const next = q.tasks.shift();
  if (!next) return;
  q.running = true;
  try {
    const result = await next.task();
    next.resolve(result);
  } catch (e) {
    next.reject(e);
  } finally {
    q.running = false;
    if (q.tasks.length === 0) userQueues.delete(userId);
    else drain(userId);
  }
}
