import { describe, it, expect } from 'vitest';
import {
  mergeSpeechTranscripts,
  cleanDuplicatePhrases,
  sanitizeDictationInput,
} from '../speechUtils';

describe('speechUtils', () => {
  describe('mergeSpeechTranscripts', () => {
    it('merges empty strings cleanly', () => {
      expect(mergeSpeechTranscripts('', 'testing')).toBe('testing');
      expect(mergeSpeechTranscripts('hello', '')).toBe('hello');
      expect(mergeSpeechTranscripts('', '')).toBe('');
    });

    it('deduplicates identical strings', () => {
      expect(mergeSpeechTranscripts('testing', 'testing')).toBe('testing');
      expect(mergeSpeechTranscripts('testing 1 2', 'testing 1 2')).toBe('testing 1 2');
    });

    it('handles addition being a superset containing the base as prefix', () => {
      expect(mergeSpeechTranscripts('testing', 'testing 1 2')).toBe('testing 1 2');
      expect(mergeSpeechTranscripts('hello world', 'hello world how are you')).toBe(
        'hello world how are you'
      );
    });

    it('merges overlapping suffix and prefix correctly', () => {
      expect(mergeSpeechTranscripts('I said testing 1 2', 'testing 1 2 it showed')).toBe(
        'I said testing 1 2 it showed'
      );
      expect(mergeSpeechTranscripts('one two three', 'three four five')).toBe(
        'one two three four five'
      );
    });

    it('appends non-overlapping text with spacing', () => {
      expect(mergeSpeechTranscripts('hello', 'world')).toBe('hello world');
      expect(mergeSpeechTranscripts('testing', '1 2')).toBe('testing 1 2');
    });
  });

  describe('cleanDuplicatePhrases', () => {
    it('collapses runaway single-word repetitions (e.g. testing testing testing testing)', () => {
      expect(cleanDuplicatePhrases('testing testing testing testing testing')).toBe('testing');
      expect(cleanDuplicatePhrases('hello hello hello')).toBe('hello');
      expect(cleanDuplicatePhrases('hello world world world')).toBe('hello world');
    });

    it('collapses multi-word phrase loops (e.g. testing 1 2 testing 1 2)', () => {
      expect(cleanDuplicatePhrases('testing 1 2 testing 1 2')).toBe('testing 1 2');
      expect(cleanDuplicatePhrases('I said testing 1 2 testing 1 2 it showed')).toBe(
        'I said testing 1 2 it showed'
      );
    });

    it('preserves allowed natural doublets like very very while removing 3+ repeats', () => {
      expect(cleanDuplicatePhrases('it is very very good')).toBe('it is very very good');
      expect(cleanDuplicatePhrases('it is very very very good')).toBe('it is very very good');
      expect(cleanDuplicatePhrases('no no no')).toBe('no no');
    });
  });

  describe('sanitizeDictationInput', () => {
    it('solves the user issue: dictating "testing 1 2" without repeating words', () => {
      // Scenario 1: Web Speech API emits "testing" then "testing testing testing"
      const step1 = sanitizeDictationInput('', 'testing');
      expect(step1).toBe('testing');

      const step2 = sanitizeDictationInput('testing', 'testing testing 1 2');
      expect(step2).toBe('testing 1 2');

      const step3 = sanitizeDictationInput('testing 1 2', 'testing 1 2 testing 1 2');
      expect(step3).toBe('testing 1 2');
    });
  });
});
