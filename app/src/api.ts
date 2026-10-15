// Typed client for the VibeForge server v2 (accounts, plans, billing, projects).

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
};

export type FileEntry = { path: string; size: number };
export type ChatMessage = { role: 'user' | 'assistant'; text: string; ts: number };

export type JobEvent = {
  seq: number;
  ts: number;
  type: 'user' | 'assistant_text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  name?: string;
  text?: string;
  path?: string;
  isError?: boolean;
};

export type Job = {
  id: string;
  projectId: string;
  status: 'running' | 'done' | 'error';
  error: string | null;
  events: JobEvent[];
  startedAt: number;
  finishedAt: number | null;
};

export type Usage = { used: number; limit: number; remaining: number; period: 'total' | 'month' };
export type Byok = { provider: string; model: string | null } | null;

export type User = {
  id: string;
  email: string;
  plan: 'free' | 'starter' | 'pro';
  planExpiresAt: number | null;
  byok: Byok;
  usage: Usage;
  createdAt: number;
};

export type Plan = {
  id: string;
  name: string;
  monthly: number;
  yearly: number;
  genLimit: number;
  period: 'total' | 'month';
  tagline: string;
  model: string;
};

export type Health = {
  ok: boolean;
  server: string;
  version: number;
  aiConfigured: boolean;
  billingConfigured: boolean;
  users: number;
};

export type ProjectDetail = {
  project: ProjectSummary;
  messages: ChatMessage[];
  files: FileEntry[];
};

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export class Api {
  base: string;
  token: string | null = null;

  constructor(base: string, token?: string | null) {
    this.base = (base || '').trim().replace(/\/+$/, '');
    this.token = token || null;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async req<T>(
    path: string,
    opts?: { method?: string; body?: unknown },
    timeoutMs = 25000
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = 'Bearer ' + this.token;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Timed out. Is the server online? Check the URL in Settings — it should look like http://192.168.1.5:8787 or https://your-app.onrender.com'
            )
          ),
        timeoutMs
      )
    );

    const request = fetch(this.base + path, {
      method: opts?.method || 'GET',
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }).then(async (res) => {
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) throw new ApiError((data && data.error) || 'HTTP ' + res.status, res.status, data);
      return data as T;
    });

    return Promise.race([request, timeout]);
  }

  // ── server ──
  health() {
    return this.req<Health>('/health', undefined, 8000);
  }

  // ── auth ──
  signup(email: string, password: string) {
    return this.req<{ token: string; user: User }>('/api/auth/signup', {
      method: 'POST',
      body: { email, password },
    });
  }

  login(email: string, password: string) {
    return this.req<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  }

  me() {
    return this.req<{ user: User; plans: Plan[] }>('/api/auth/me', undefined, 12000);
  }

  setByok(provider: string, key: string, model?: string) {
    return this.req<{ ok: boolean }>('/api/auth/byok', {
      method: 'POST',
      body: { provider, key, model },
    });
  }

  removeByok() {
    return this.req<{ ok: boolean }>('/api/auth/byok', { method: 'DELETE' });
  }

  // ── billing ──
  checkout(planId: string, period: 'month' | 'year') {
    return this.req<{ url: string; id: string; amount: number; months: number }>(
      '/api/billing/checkout',
      { method: 'POST', body: { planId, period } },
      30000
    );
  }

  verifyPayment(linkId: string) {
    return this.req<{ paid: boolean; status?: string; user?: User }>(
      '/api/billing/verify',
      { method: 'POST', body: { linkId } },
      20000
    );
  }

  redeem(code: string) {
    return this.req<{ ok: boolean; user: User }>('/api/billing/redeem', {
      method: 'POST',
      body: { code },
    });
  }

  // ── projects ──
  listProjects() {
    return this.req<{ projects: ProjectSummary[] }>('/api/projects');
  }

  createProject(name: string) {
    return this.req<{ project: ProjectSummary }>('/api/projects', {
      method: 'POST',
      body: { name },
    });
  }

  getProject(id: string) {
    return this.req<ProjectDetail>('/api/projects/' + id);
  }

  deleteProject(id: string) {
    return this.req<{ ok: boolean }>('/api/projects/' + id, { method: 'DELETE' });
  }

  chat(id: string, prompt: string) {
    return this.req<{ jobId: string }>(
      '/api/projects/' + id + '/chat',
      { method: 'POST', body: { prompt } },
      30000
    );
  }

  getJob(jobId: string) {
    return this.req<Job>('/api/jobs/' + jobId, undefined, 12000);
  }

  getFile(id: string, filePath: string) {
    return this.req<{ path: string; content: string }>(
      '/api/projects/' + id + '/file?path=' + encodeURIComponent(filePath)
    );
  }

  previewUrl(id: string) {
    return this.base + '/preview/' + id + '/';
  }
}
