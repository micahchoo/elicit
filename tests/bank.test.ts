import { describe, it, expect } from 'vitest';
import { isWeakForm } from '../src/language/weak-form.js';

describe('isWeakForm', () => {
	describe('rejects yes/no forms', () => {
		it.each([
			['do', 'Do you keep a journal?'],
			['does', 'Does it feel good to help?'],
			['did', 'Did you ever run away from home?'],
			['have', "have you ever lied to protect someone else's feelings?"],
			['has', 'Has anyone ever broken your trust?'],
			['are', 'Are we tricked by our tools?'],
			['is', 'Is there anything you could not forgive?'],
			['was', 'Was that the best decision you ever made?'],
			['were', 'Were you ever afraid of the dark?'],
			['will', 'Will you still love me tomorrow?'],
			['would', 'Would it be easier if you had help?'],
			['can', 'Can you remember your first dream?'],
			['could', 'Could you live without the internet?'],
			['should', 'Should I have stayed in that job?'],
		])('%s-leading question is rejected', (_verb, question) => {
			expect(isWeakForm(question)).toBe(true);
		});

		it('matches the auxiliary case-insensitively in the middle of mixed case', () => {
			expect(isWeakForm('ShOuLd we start over?')).toBe(true);
		});

		it('does not reject words that merely contain an auxiliary', () => {
			expect(isWeakForm('Doeskin leather ages well?')).toBe(false);
			expect(isWeakForm('Candlelight changes a room?')).toBe(false);
		});
	});

	describe('rejects multi-question strings', () => {
		it.each([
			"what's a hobby that you quit? why?",
			'Do you like coffee? Tea?',
			'Why here? Why now?',
			'What changed? And what did not?',
		])('rejects %j', (question) => {
			expect(isWeakForm(question)).toBe(true);
		});
	});

	describe('rejects leading junk', () => {
		it.each([
			['#', '# What is your favorite book?'],
			['>', '> What keeps you up at night?'],
			['*', '* Where did you grow up?'],
			['numbered', '####6. What would you like to change?'],
			['number', '6 What is your earliest memory?'],
		])('%s prefix is rejected', (_label, question) => {
			expect(isWeakForm(question)).toBe(true);
		});

		it('rejects leading punctuation', () => {
			expect(isWeakForm('—What do you hope for?')).toBe(true);
			expect(isWeakForm('"Why do you stay?"')).toBe(true);
		});
	});

	describe('accepts valid open forms', () => {
		it.each([
			['what', 'What was your last pinch me moment?'],
			['when', 'when was the last time someone disappointed you?'],
			['why', 'Why do you do the work you do?'],
			['how', 'How do you unwind after a hard day?'],
			['who', 'Who taught you the most?'],
			['where', 'Where do you feel most at home?'],
			['which', 'Which habit changed your life?'],
			['tell me', 'Tell me about a moment this week that stuck with you.'],
			['describe', 'Describe a place you love.'],
			['imperative', 'Share a memory that makes you smile.'],
		])('%s opener is accepted', (_label, question) => {
			expect(isWeakForm(question)).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('rejects the empty string', () => {
			expect(isWeakForm('')).toBe(true);
		});

		it('accepts a bare letter', () => {
			expect(isWeakForm('a')).toBe(false);
			expect(isWeakForm('Z')).toBe(false);
		});

		it('rejects punctuation-only strings', () => {
			expect(isWeakForm('?')).toBe(true);
			expect(isWeakForm('?!')).toBe(true);
			expect(isWeakForm('...')).toBe(true);
		});
	});
});
