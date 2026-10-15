// In-memory job registry. The app starts a "job" for each prompt and polls it.
export class Jobs {
  constructor() {
    this.map = new Map();
    this.seq = 0;
  }

  create(projectId, runner) {
    const id = 'job_' + ++this.seq + '_' + Math.random().toString(36).slice(2, 8);
    const job = {
      id,
      projectId,
      status: 'running',
      events: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.map.set(id, job);

    const onEvent = (ev) => {
      ev.seq = job.events.length + 1;
      ev.ts = ev.ts || Date.now();
      job.events.push(ev);
      if (job.events.length > 600) job.events.splice(0, job.events.length - 600);
    };

    Promise.resolve()
      .then(() => runner(onEvent))
      .then(() => {
        job.status = 'done';
      })
      .catch((e) => {
        job.status = 'error';
        job.error = String((e && e.message) || e);
        onEvent({ type: 'error', text: job.error });
      })
      .finally(() => {
        job.finishedAt = Date.now();
      });

    return job;
  }

  get(id) {
    return this.map.get(id) || null;
  }

  runningFor(projectId) {
    for (const j of this.map.values()) {
      if (j.projectId === projectId && j.status === 'running') return j;
    }
    return null;
  }

  snapshot(id) {
    const j = this.map.get(id);
    if (!j) return null;
    return {
      id: j.id,
      projectId: j.projectId,
      status: j.status,
      error: j.error,
      events: j.events,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
    };
  }
}
