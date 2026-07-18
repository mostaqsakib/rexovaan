// Global FIFO job queue. The checker uses one shared Chrome profile/context,
// so running multiple Telegram jobs in parallel can overload Chrome/Google and
// make both the bot checker and site checker look stuck.

const queue = { running: false, tasks: [] };

export function enqueue(userId, task) {
  return new Promise((resolve, reject) => {
    queue.tasks.push({ userId, task, resolve, reject });
    drain();
  });
}

export function pendingCount(userId) {
  return queue.tasks.length + (queue.running ? 1 : 0);
}

async function drain() {
  if (queue.running) return;
  const next = queue.tasks.shift();
  if (!next) return;
  queue.running = true;
  try {
    const result = await next.task();
    next.resolve(result);
  } catch (e) {
    next.reject(e);
  } finally {
    queue.running = false;
    if (queue.tasks.length > 0) drain();
  }
}
