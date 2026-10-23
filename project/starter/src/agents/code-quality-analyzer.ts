import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/index.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description: 'Analyze pull request code for quality, security, maintainability, and performance issues with actionable severity levels.',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
  model: 'inherit',
  prompt: CODE_QUALITY_ANALYZER_PROMPT
};
