import { makeComplete } from '../src/llm.js';
import { getProtocol } from '../src/protocols/registry.js';
const complete = makeComplete();
// The reflective system prompt lives in the file-based protocol def — the
// prompt literal was deleted from src/elicitor/protocol.ts (Wave A), and
// the defs/*.md registry is its one home. A missing def is repo
// corruption: fail loudly rather than complete() with an empty prompt.
const def = getProtocol('reflective');
if (!def) throw new Error('reflective protocol def not found');
const REFLECTIVE_INTERVIEW_PROMPT = def.prompt;
const convs: { role: 'agent'|'user'; text: string }[][] = [
  [
    { role: 'agent', text: 'What do you believe about how people change?' },
    { role: 'user', text: 'Sometimes they change because something lands on them before they have decided what to make of it' },
  ],
  [
    { role: 'agent', text: 'Tell me about a moment this week that stuck with you.' },
    { role: 'user', text: 'Helping a friend pack up their flat over a video call and watching what each box did to them' },
  ],
];
for (const conv of convs) {
  const turns = conv.map((t, i) => ({ ...t, at: String(i) }));
  for (let i = 0; i < 2; i++) {
    const probe = await complete(REFLECTIVE_INTERVIEW_PROMPT, turns, { temperature: 0.8 });
    console.log(`probe: ${probe.trim()}`);
    turns.push({ role: 'agent', text: probe.trim(), at: 'x' });
    turns.push({ role: 'user', text: i === 0 ? 'It was mostly weight, I think — watching someone decide what stays and what goes.' : 'I suppose it showed me how much rooms remember.', at: 'y' });
  }
  console.log('---');
}
