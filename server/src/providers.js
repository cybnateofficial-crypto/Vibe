// Provider drivers: Anthropic | OpenAI-compatible | Gemini | Mock (demo).
// Each driver exposes: name, model, ready, and step(messages, system, tools) -> { parts }.
// Neutral message format:
//   { role: 'user'|'assistant', parts: [ {type:'text',text} |
//     {type:'tool_call',id,name,input} | {type:'tool_result',id,name,output,isError} ] }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ────────────────────────── format converters ──────────────────────────

function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const content = m.parts.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'tool_use', id: p.id, name: p.name, input: p.input || {} }
      );
      return { role: 'assistant', content };
    }
    const content = m.parts.map((p) =>
      p.type === 'tool_result'
        ? {
            type: 'tool_result',
            tool_use_id: p.id,
            content: [{ type: 'text', text: String(p.output).slice(0, 30000) }],
            is_error: !!p.isError,
          }
        : { type: 'text', text: p.text }
    );
    return { role: 'user', content };
  });
}

function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const calls = m.parts.filter((p) => p.type === 'tool_call');
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        }));
      }
      out.push(msg);
    } else {
      const texts = m.parts.filter((p) => p.type === 'text').map((p) => p.text);
      const results = m.parts.filter((p) => p.type === 'tool_result');
      if (texts.length) out.push({ role: 'user', content: texts.join('\n') });
      for (const r of results) {
        out.push({
          role: 'tool',
          tool_call_id: r.id,
          content: String(r.output).slice(0, 30000),
        });
      }
    }
  }
  return out;
}

function toGeminiContents(messages) {
  return messages.map((m) =>
    m.role === 'assistant'
      ? {
          role: 'model',
          parts: m.parts.map((p) =>
            p.type === 'text'
              ? { text: p.text }
              : { functionCall: { name: p.name, args: p.input || {} } }
          ),
        }
      : {
          role: 'user',
          parts: m.parts.map((p) =>
            p.type === 'tool_result'
              ? {
                  functionResponse: {
                    name: p.name,
                    response: { result: String(p.output).slice(0, 30000) },
                  },
                }
              : { text: p.text }
          ),
        }
  );
}

function prettyApiError(provider, status, body) {
  const snippet = String(body || '').slice(0, 400);
  let hint = '';
  if (status === 401 || status === 403) hint = ' — your API key looks invalid or is missing. Check server/.env';
  else if (status === 400 && /credit|billing|quota/i.test(snippet)) hint = ' — you may have no credits/billing set up on the provider account';
  else if (status === 429) hint = ' — rate limit or out of credits. Wait a bit or check billing';
  else if (status === 404) hint = ' — model name may be wrong. Check the *_MODEL value in server/.env';
  return new Error(provider + ' API ' + status + ': ' + snippet + hint);
}

// ────────────────────────── Anthropic ──────────────────────────

class AnthropicProvider {
  constructor(key, model) {
    this.name = 'anthropic';
    this.model = model || 'claude-sonnet-5';
    this.key = key;
    this.ready = !!key;
  }

  async step(messages, system, tools) {
    const body = {
      model: this.model,
      max_tokens: 8192,
      system,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw prettyApiError('Anthropic', res.status, await res.text());
    const data = await res.json();
    const parts = [];
    for (const block of data.content || []) {
      if (block.type === 'text' && block.text) parts.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use')
        parts.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input || {} });
    }
    return {
      parts,
      usage: {
        in: (data.usage && data.usage.input_tokens) || 0,
        out: (data.usage && data.usage.output_tokens) || 0,
      },
    };
  }
}

// ────────────────────────── OpenAI-compatible ──────────────────────────

class OpenAIProvider {
  constructor(key, model, baseUrl) {
    this.name = 'openai';
    this.model = model || 'gpt-5.5';
    this.key = key;
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.ready = !!key;
  }

  async step(messages, system, tools) {
    const body = {
      model: this.model,
      messages: toOpenAIMessages(system, messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: 'auto',
    };
    const res = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.key },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw prettyApiError('OpenAI', res.status, await res.text());
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const parts = [];
    if (!msg) return { parts };
    if (msg.content) parts.push({ type: 'text', text: String(msg.content) });
    for (const tc of msg.tool_calls || []) {
      let input = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}');
      } catch {
        input = {};
      }
      parts.push({
        type: 'tool_call',
        id: tc.id || 'call_' + Math.random().toString(36).slice(2, 8),
        name: tc.function.name,
        input,
      });
    }
    return {
      parts,
      usage: {
        in: (data.usage && data.usage.prompt_tokens) || 0,
        out: (data.usage && data.usage.completion_tokens) || 0,
      },
    };
  }
}

// ────────────────────────── Gemini ──────────────────────────

class GeminiProvider {
  constructor(key, model) {
    this.name = 'gemini';
    this.model = model || 'gemini-2.5-flash';
    this.key = key;
    this.ready = !!key;
  }

  async step(messages, system, tools) {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        },
      ],
      generationConfig: { maxOutputTokens: 8192 },
    };
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      this.model +
      ':generateContent?key=' +
      encodeURIComponent(this.key);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw prettyApiError('Gemini', res.status, await res.text());
    const data = await res.json();
    const cand = (data.candidates && data.candidates[0]) || null;
    const gparts = (cand && cand.content && cand.content.parts) || [];
    const parts = [];
    let i = 0;
    for (const gp of gparts) {
      if (gp.text) parts.push({ type: 'text', text: gp.text });
      if (gp.functionCall) {
        parts.push({
          type: 'tool_call',
          id: 'g' + ++i + '_' + Date.now().toString(36),
          name: gp.functionCall.name,
          input: gp.functionCall.args || {},
        });
      }
    }
    const um = data.usageMetadata || {};
    return {
      parts,
      usage: {
        in: um.promptTokenCount || 0,
        out: um.candidatesTokenCount || 0,
      },
    };
  }
}

// ────────────────────────── Mock (demo mode, no key needed) ──────────────────────────

const MOCK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Taskly — your todo app</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="app">
    <header class="head">
      <h1>Taskly</h1>
      <p class="sub">Tap to complete. Your data stays on this device.</p>
    </header>

    <form id="add-form" class="add">
      <input id="new-task" type="text" placeholder="Add a task…" autocomplete="off" />
      <button type="submit" aria-label="Add task">＋</button>
    </form>

    <ul id="list" class="list"></ul>

    <footer class="foot">
      <span id="count">0 tasks</span>
      <div class="filters">
        <button data-filter="all" class="on" type="button">All</button>
        <button data-filter="active" type="button">Active</button>
        <button data-filter="done" type="button">Done</button>
      </div>
    </footer>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;

const MOCK_CSS = `:root{--bg:#0b0d12;--card:#151a26;--border:#242c3f;--text:#eaeef7;--muted:#8b93a7;--accent:#7c5cff;--green:#3ddc97}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#1c1440 0%,var(--bg) 55%);color:var(--text);min-height:100vh;display:flex;justify-content:center;padding:32px 16px}
.app{width:100%;max-width:520px}
.head h1{margin:0;font-size:34px;letter-spacing:-.5px}
.head .sub{color:var(--muted);margin:6px 0 22px;font-size:14px}
.add{display:flex;gap:10px;margin-bottom:18px}
.add input{flex:1;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;color:var(--text);font-size:15px;outline:none;transition:border-color .2s}
.add input:focus{border-color:var(--accent)}
.add button{width:50px;border:0;border-radius:14px;background:var(--accent);color:#fff;font-size:22px;cursor:pointer;transition:transform .15s,filter .2s}
.add button:hover{filter:brightness(1.1);transform:translateY(-1px)}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.item{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:13px 14px;animation:pop .25s ease}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.item .check{width:22px;height:22px;border-radius:8px;border:2px solid var(--border);background:transparent;cursor:pointer;flex:0 0 auto;display:grid;place-items:center;color:transparent;font-size:13px;transition:all .2s}
.item.done .check{background:var(--green);border-color:var(--green);color:#05261a}
.item .label{flex:1;font-size:15px;transition:color .2s}
.item.done .label{color:var(--muted);text-decoration:line-through}
.item .del{border:0;background:transparent;color:var(--muted);font-size:17px;cursor:pointer;padding:4px 6px;border-radius:8px}
.item .del:hover{color:#ff6b6b;background:#2a1a22}
.empty{color:var(--muted);text-align:center;padding:34px 10px;border:1px dashed var(--border);border-radius:14px;font-size:14px}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:20px;color:var(--muted);font-size:13px}
.filters{display:flex;gap:6px}
.filters button{border:1px solid var(--border);background:transparent;color:var(--muted);border-radius:10px;padding:6px 12px;cursor:pointer;font-size:13px}
.filters button.on{background:var(--accent);border-color:var(--accent);color:#fff}
`;

const MOCK_JS = `(function () {
  var KEY = 'taskly.tasks.v1';
  var state = { tasks: JSON.parse(localStorage.getItem(KEY) || '[]'), filter: 'all' };
  var list = document.getElementById('list');
  var form = document.getElementById('add-form');
  var input = document.getElementById('new-task');
  var count = document.getElementById('count');

  function save() { localStorage.setItem(KEY, JSON.stringify(state.tasks)); }

  function visible() {
    return state.tasks.filter(function (t) {
      return state.filter === 'all' || (state.filter === 'active' && !t.done) || (state.filter === 'done' && t.done);
    });
  }

  function render() {
    var items = visible();
    list.innerHTML = '';
    if (!items.length) {
      var e = document.createElement('li');
      e.className = 'empty';
      e.textContent = state.tasks.length ? 'Nothing here — try another filter.' : 'No tasks yet. Add your first one above ✨';
      list.appendChild(e);
    }
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'item' + (t.done ? ' done' : '');
      var c = document.createElement('button');
      c.className = 'check'; c.type = 'button'; c.textContent = '✓';
      c.onclick = function () { t.done = !t.done; save(); render(); };
      var s = document.createElement('span');
      s.className = 'label'; s.textContent = t.text;
      var d = document.createElement('button');
      d.className = 'del'; d.type = 'button'; d.textContent = '✕';
      d.onclick = function () {
        state.tasks = state.tasks.filter(function (x) { return x !== t; });
        save(); render();
      };
      li.appendChild(c); li.appendChild(s); li.appendChild(d);
      list.appendChild(li);
    });
    var left = state.tasks.filter(function (t) { return !t.done; }).length;
    count.textContent = left + (left === 1 ? ' task left' : ' tasks left');
  }

  form.onsubmit = function (ev) {
    ev.preventDefault();
    var v = input.value.trim();
    if (!v) return;
    state.tasks.unshift({ text: v, done: false, at: Date.now() });
    input.value = '';
    save(); render();
  };

  var buttons = document.querySelectorAll('.filters button');
  for (var i = 0; i < buttons.length; i++) {
    (function (b) {
      b.onclick = function () {
        state.filter = b.dataset.filter;
        for (var j = 0; j < buttons.length; j++) buttons[j].classList.toggle('on', buttons[j] === b);
        render();
      };
    })(buttons[i]);
  }

  render();
})();
`;

class MockProvider {
  constructor() {
    this.name = 'mock';
    this.model = 'demo-mode';
    this.ready = true;
  }

  async step(messages) {
    const firstUser = messages.find((m) => m.role === 'user' && m.parts[0] && m.parts[0].text);
    const contextText = firstUser ? firstUser.parts[0].text : '';
    const reqMatch = contextText.match(/USER REQUEST: ([\s\S]*?)\n/);
    const request = (reqMatch ? reqMatch[1] : '').toLowerCase();
    const brandNew = contextText.includes('brand new project');

    await sleep(800);

    if (brandNew) {
      return {
        parts: [
          {
            type: 'text',
            text: "Demo mode is on — this sample app was built by the built-in mock, not a real AI. Add an API key in server/.env (ANTHROPIC_API_KEY is recommended) and restart the server for full creative quality. Meanwhile, here's a real working app so you can feel the whole flow!",
          },
          { type: 'tool_call', id: 'm1', name: 'write_file', input: { path: 'index.html', content: MOCK_HTML } },
          { type: 'tool_call', id: 'm2', name: 'write_file', input: { path: 'styles.css', content: MOCK_CSS } },
          { type: 'tool_call', id: 'm3', name: 'write_file', input: { path: 'app.js', content: MOCK_JS } },
          {
            type: 'tool_call',
            id: 'm4',
            name: 'finish',
            input: {
              summary:
                'Built Taskly — a working todo app with add, complete, delete, filters, and localStorage persistence. Open the Preview tab to try it!',
            },
          },
        ],
      };
    }

    const colors = {
      blue: '#3b82f6',
      red: '#ef4444',
      green: '#22c55e',
      purple: '#8b5cf6',
      orange: '#f97316',
      pink: '#ec4899',
      teal: '#14b8a6',
    };
    const found = Object.keys(colors).find((c) => request.includes(c));
    let css = MOCK_CSS;
    let note;
    if (found) {
      css = MOCK_CSS.replace(/--accent:\s*#7c5cff/gi, '--accent:' + colors[found]);
      note = 'Switched the accent color to ' + found + ' across the whole app.';
    } else {
      css = MOCK_CSS.replace(/14px/g, '18px');
      note = 'Softened the styling with rounder corners. (Demo mode keeps changes simple.)';
    }

    return {
      parts: [
        {
          type: 'text',
          text: 'Demo mode: applying a small change so you can see the edit loop work.',
        },
        { type: 'tool_call', id: 'm5', name: 'read_file', input: { path: 'styles.css' } },
        { type: 'tool_call', id: 'm6', name: 'write_file', input: { path: 'styles.css', content: css } },
        { type: 'tool_call', id: 'm7', name: 'finish', input: { summary: note } },
      ],
    };
  }
}

// ────────────────────────── selection ──────────────────────────

export function pickProvider() {
  const explicit = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  const choice =
    explicit ||
    (anthropicKey ? 'anthropic' : openaiKey ? 'openai' : geminiKey ? 'gemini' : 'mock');

  if (choice === 'mock') return new MockProvider();
  if (choice === 'anthropic') {
    if (!anthropicKey)
      throw new Error('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty in server/.env');
    return new AnthropicProvider(anthropicKey, process.env.ANTHROPIC_MODEL);
  }
  if (choice === 'openai') {
    if (!openaiKey) throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is empty in server/.env');
    return new OpenAIProvider(
      openaiKey,
      process.env.OPENAI_MODEL,
      process.env.OPENAI_BASE_URL
    );
  }
  if (choice === 'gemini') {
    if (!geminiKey) throw new Error('AI_PROVIDER=gemini but GEMINI_API_KEY is empty in server/.env');
    return new GeminiProvider(geminiKey, process.env.GEMINI_MODEL);
  }
  throw new Error('Unknown AI_PROVIDER "' + explicit + '" — use anthropic, openai, gemini or mock');
}

export { MockProvider, AnthropicProvider, OpenAIProvider, GeminiProvider };
