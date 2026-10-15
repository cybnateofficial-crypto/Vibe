// The agent loop: prompt -> AI plans -> tool calls (write files) -> repeat -> finish.
// Returns { text, usage } so the caller can meter token spend per user.
import { TOOL_DEFS, executeTool } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { matchSkills } from './skills.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAgent({ provider, ws, projectId, prompt, onEvent, maxSteps = 14 }) {
  const meta = ws.meta(projectId);
  meta.messages = meta.messages || [];
  meta.messages.push({ role: 'user', text: prompt, ts: Date.now() });
  ws.saveMeta(projectId, meta);
  onEvent({ type: 'user', text: prompt });

  const tree = ws.tree(projectId);
  const skills = matchSkills(prompt);
  const system = buildSystemPrompt(skills);
  const recent = (meta.messages || [])
    .slice(-9, -1)
    .map((m) => (m.role === 'user' ? 'User: ' : 'You: ') + String(m.text).slice(0, 600))
    .join('\n');

  const context = [
    'USER REQUEST: ' + prompt,
    '',
    'CURRENT PROJECT FILES (' + tree.length + '):',
    tree.map((f) => '- ' + f.path + ' (' + f.size + ' bytes)').join('\n') ||
      '(empty — this is a brand new project)',
    '',
    recent ? 'RECENT CONVERSATION:\n' + recent : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [{ role: 'user', parts: [{ type: 'text', text: context }] }];

  let step = 0;
  let finished = false;
  let finalText = '';
  const textParts = [];
  const usage = { tokensIn: 0, tokensOut: 0 };

  while (step < maxSteps && !finished) {
    step++;
    const res = await provider.step(messages, system, TOOL_DEFS);
    const parts = (res && res.parts) || [];
    if (res && res.usage) {
      usage.tokensIn += res.usage.in || 0;
      usage.tokensOut += res.usage.out || 0;
    }
    if (!parts.length) break;
    messages.push({ role: 'assistant', parts });

    const calls = [];
    for (const p of parts) {
      if (p.type === 'text' && p.text && p.text.trim()) {
        textParts.push(p.text.trim());
        onEvent({ type: 'assistant_text', text: p.text.trim() });
      }
      if (p.type === 'tool_call') calls.push(p);
    }

    if (!calls.length) {
      finalText = textParts.join('\n\n');
      finished = true;
      break;
    }

    const results = [];
    for (const call of calls) {
      onEvent({
        type: 'tool_call',
        name: call.name,
        path: call.input && call.input.path ? call.input.path : undefined,
      });
      const r = executeTool(call, ws, projectId);
      onEvent({ type: 'tool_result', name: call.name, text: r.summary, isError: r.isError });
      results.push({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        output: r.output,
        isError: r.isError,
      });
      if (r.finish) {
        finished = true;
        finalText = (call.input && call.input.summary) || 'All done.';
        break;
      }
      if (provider.name === 'mock') await sleep(280);
    }

    if (!finished) {
      messages.push({
        role: 'user',
        parts: results.length ? results : [{ type: 'text', text: 'Continue.' }],
      });
    }
  }

  if (!finalText) {
    finalText =
      textParts.join('\n\n') || 'I reached the step limit for this turn. Ask me to continue.';
  }
  const meta2 = ws.meta(projectId);
  meta2.messages = meta2.messages || [];
  meta2.messages.push({ role: 'assistant', text: finalText, ts: Date.now() });
  ws.saveMeta(projectId, meta2);
  onEvent({ type: 'done', text: finalText });
  return { text: finalText, usage };
}
