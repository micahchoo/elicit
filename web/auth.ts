/**
 * The auth screens — login, setup, and the done screen — moved whole from
 * main.ts (wave C); every rendered string, class, DOM structure and e2e
 * selector is byte-identical.
 *
 * Injection, not import (the seam, web/deps.ts): main, el, api, navTo, the
 * wait verbs, the shell verbs and the live-refresh start all arrive via
 * initAuth at boot — the territory pattern. The render functions are
 * bare, exactly as the router calls them; a forgotten init is loud.
 */
import { ApiError } from './deps.js';
import type { WebDepsCore, WebDepsWithWait } from './deps.js';

/** The auth screens' deps, injected once at boot (web/deps.ts). */
export interface AuthDeps {
 main: HTMLElement;
 surface: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 navTo: (screen: string) => void;
 beginWait: WebDepsWithWait['beginWait'];
 clear: () => void;
 setScreen: (screen: string) => void;
 renderShell: () => void;
 /** The live-refresh start, called once a login succeeds. */
 startLiveRefresh: () => void;
 /** The buds from the last harvest, shown on the done screen (ticket 140). */
 pendingBuds: () => unknown[];
}

let authDeps: AuthDeps | null = null;

/** Wire the auth screens' deps once at boot. */
export function initAuth(deps: AuthDeps): void {
 authDeps = deps;
}

function wired(): AuthDeps {
 const deps = authDeps;
 if (deps === null) {
  throw new Error('auth not initialized — call initAuth before renderLogin');
 }
 return deps;
}

/* ── Login screen ── */

export function renderLogin() {
 const deps = wired();
 deps.clear();
 // No nav before auth: a stale shell from a previous session leaves.
 deps.main.querySelector('.topnav')?.remove();
 deps.setScreen('login');

 const div = deps.el('div', { class: 'screen active login-form' });
 const heading = deps.el('h1', { class: 'login-heading' }, 'elicit');
 const input = deps.el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'password',
 });
 const submit = deps.el('button', { class: 'submit-btn' }, 'enter');
 const errorSlot = deps.el('div', { class: 'error-slot' });

 submit.addEventListener('click', async () => {
  submit.disabled = true;
  errorSlot.innerHTML = '';
  const wait = deps.beginWait(errorSlot, 'checking…');
  try {
   await deps.api('/api/login', { password: input.value });
   wait.done();
   deps.startLiveRefresh();
   deps.navTo('mode');
  } catch (e) {
   const rejected = e instanceof ApiError && e.status === 401;
   wait.failed(e, rejected ? 'wrong password' : undefined);
   submit.disabled = false;
   input.focus();
  }
 });

 input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 div.append(heading, input, submit, errorSlot);
 deps.surface.append(div);
 input.focus();
}

/* ── Setup screen ── */

export function renderSetup() {
 const deps = wired();
 deps.clear();
 // No nav before auth: a stale shell from a previous session leaves.
 deps.main.querySelector('.topnav')?.remove();
 deps.setScreen('setup');

 const div = deps.el('div', { class: 'screen active login-form' });
 const heading = deps.el('h1', { class: 'login-heading' }, 'set a password');
 const hint = deps.el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin-bottom: 0.5rem' }, 'choose a password to gate LAN access');
 const input = deps.el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'password',
 });
 const confirm = deps.el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'confirm password',
 });
 // Who the vault is about — optional, skippable, changeable later via
 // POST /api/profile. The wiki writes about the person; given a name and
 // pronouns it uses them instead of "the user".
 const nameHint = deps.el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin: 0.75rem 0 0.5rem' }, 'what should the wiki call you? (optional)');
 const nameInput = deps.el('input', {
  class: 'login-input',
  type: 'text',
  placeholder: 'your name',
 });
 const pronounsInput = deps.el('input', {
  class: 'login-input',
  type: 'text',
  placeholder: 'your pronouns (e.g. they/them)',
 });
 const submit = deps.el('button', { class: 'submit-btn' }, 'set password');
 const errorSlot = deps.el('div', { class: 'error-slot' });
 const backLink = deps.el('button', { class: 'nav-link' }, '\u2190 back');
 backLink.addEventListener('click', () => deps.navTo('mode'));

 submit.addEventListener('click', async () => {
  const pw = input.value;
  if (!pw) {
   errorSlot.innerHTML = '';
   errorSlot.append('password cannot be empty');
   return;
  }
  if (pw !== confirm.value) {
   errorSlot.innerHTML = '';
   errorSlot.append('passwords do not match');
   return;
  }
  submit.disabled = true;
  errorSlot.innerHTML = '';
  const wait = deps.beginWait(errorSlot, 'saving the password…');
  try {
   await deps.api('/api/setup', { password: pw });
   // Best-effort: the password gate is set either way, and the profile can
   // be set later through the same route.
   if (nameInput.value.trim() || pronounsInput.value.trim()) {
    try {
     await deps.api('/api/profile', {
      name: nameInput.value.trim(),
      pronouns: pronounsInput.value.trim(),
     });
    } catch {
     // The vault opens without a profile; nothing is lost but the name.
    }
   }
   wait.done();
   deps.navTo('mode');
  } catch (e) {
   wait.failed(e);
   submit.disabled = false;
  }
 });

 confirm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 div.append(backLink, heading, hint, input, confirm, nameHint, nameInput, pronounsInput, submit, errorSlot);
 deps.surface.append(div);
 input.focus();
}

/* ── Done screen ── */

export function renderDone() {
 const deps = wired();
 deps.clear();
 deps.setScreen('done');
 deps.renderShell();
 const div = deps.el('div', { class: 'screen active' });
 const msg = deps.el(
  'p',
  { class: 'done-message' },
  'your answers are saved.',
 );
 const backBtn = deps.el('button', { class: 'submit-btn', style: 'margin-top: 1rem' }, 'back');
 backBtn.addEventListener('click', () => deps.navTo('mode'));
 div.append(msg, backBtn);

 if (deps.pendingBuds().length > 0) {
  const budsSection = deps.el('div', { class: 'done-buds' });
  budsSection.append(deps.el('p', { class: 'done-buds-heading' }, `${deps.pendingBuds().length} fragment${deps.pendingBuds().length === 1 ? '' : 's'} did not stand on ${deps.pendingBuds().length === 1 ? 'its' : 'their'} own`));
  for (const bud of deps.pendingBuds()) {
   const b = bud as { text: string };
   budsSection.append(deps.el('p', { class: 'done-bud-text' }, b.text));
  }
  div.append(budsSection);
 }
 deps.surface.append(div);
}
