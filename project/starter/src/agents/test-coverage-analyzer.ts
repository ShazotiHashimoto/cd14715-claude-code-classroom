import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description: 'Evaluate test completeness, identify untested paths, and suggest concrete tests for each changed file.',
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT
};
