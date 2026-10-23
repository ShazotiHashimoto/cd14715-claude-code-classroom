import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

export const refactoringSuggester: AgentDefinition = {
  description: 'Suggest safe refactors, modernization steps, and simplification opportunities from code review findings.',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
  model: 'inherit',
  prompt: REFACTORING_SUGGESTER_PROMPT
};
