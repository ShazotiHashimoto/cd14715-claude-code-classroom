import { query } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { codeQualityAnalyzer, refactoringSuggester, testCoverageAnalyzer } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { ErrorCodes, ReviewError, withRetry, withTimeout } from './utils/error-handler.js';
import { RateLimiter, type RateLimiterConfig } from './utils/rate-limiter.js';
import { withRateLimit } from './utils/rate-limiter.js';
import type { ReviewReport } from './types/index.js';

export interface OrchestratorOptions {
  maxTurns?: number;
  model?: string;
  rateLimits?: Partial<RateLimiterConfig>;
}

export class CodeReviewOrchestrator {
  private readonly options: OrchestratorOptions;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      maxTurns: 60,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
      ...options
    };
    this.rateLimiter = new RateLimiter(options.rateLimits ?? {});
  }

  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    return withRetry(async () => {
      const abortController = new AbortController();
      try {
        return await withTimeout(
          () => withRateLimit(this.rateLimiter, async () => {
        const result = query({
          prompt: buildOrchestratorPrompt(owner, repo, prNumber),
          options: {
            model: this.options.model,
            maxTurns: this.options.maxTurns,
            abortController,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            allowedTools: [
              'Task', 'Read', 'Grep', 'Glob', 'WebFetch',
              'mcp__github__get_pull_request', 'mcp__eslint__lint'
            ],
            agents: {
              'code-quality-analyzer': codeQualityAnalyzer,
              'test-coverage-analyzer': testCoverageAnalyzer,
              'refactoring-suggester': refactoringSuggester
            },
            mcpServers: mcpServersConfig,
            outputFormat: {
              type: 'json_schema',
              schema: ReviewReportJSONSchema
            }
          }
        });

        for await (const message of result) {
          if (message.type === 'result') {
            if (message.subtype !== 'success') {
              throw new ReviewError(
                (message as { errors?: string[] }).errors?.join(', ') ?? 'Review query failed.',
                ErrorCodes.AGENT_FAILED
              );
            }

            if (message.structured_output && typeof message.structured_output === 'object') {
              const parsed = ReviewReportSchema.safeParse(message.structured_output);
              if (parsed.success) {
                return parsed.data;
              }
              throw new ReviewError(
                'The orchestrator returned output that does not match the ReviewReport schema.',
                ErrorCodes.VALIDATION_FAILED,
                { issues: parsed.error.issues }
              );
            }
          }
        }

        throw new ReviewError(
          'No structured output received from the orchestrator.',
          ErrorCodes.STRUCTURED_OUTPUT_FAILED
        );
          }), 300000);
      } catch (error) {
        abortController.abort();
        throw error;
      }
    }, 1, 250, (error) => {
      if (error instanceof ReviewError) {
        return error.code === ErrorCodes.AGENT_FAILED &&
          /429|rate.?limit|overload|temporar|ECONNRESET|ECONNREFUSED/i.test(error.message);
      }
      return true;
    });
  }
}
