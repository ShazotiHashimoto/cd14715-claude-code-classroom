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
  timeoutMs?: number;
  rateLimits?: Partial<RateLimiterConfig>;
}

export class CodeReviewOrchestrator {
  private readonly options: OrchestratorOptions;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      maxTurns: 60,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
      timeoutMs: 900000,
      ...options
    };
    this.rateLimiter = new RateLimiter(options.rateLimits ?? {});
  }

  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const startedAt = Date.now();
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
            permissionMode: 'dontAsk',
            tools: ['Task', 'Read', 'Grep', 'Glob', 'WebFetch'],
            allowedTools: [
              'Task', 'Read', 'Grep', 'Glob', 'WebFetch',
              'mcp__github__get_pull_request',
              'mcp__github__get_pull_request_files',
              'mcp__eslint__lint-files'
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
                const report = parsed.data;
                const fileReviews = report.fileReviews;
                const qualityScores = fileReviews.map((review) => review.codeQuality.overallScore);
                const untestedPaths = fileReviews.flatMap((review) => review.testCoverage.untestedPaths);
                report.summary = {
                  totalFiles: fileReviews.length,
                  overallScore: qualityScores.length === 0
                    ? 0
                    : Math.round(qualityScores.reduce((total, score) => total + score, 0) / qualityScores.length),
                  criticalIssues: fileReviews.reduce((total, review) => total +
                    review.codeQuality.issues.filter((issue) => issue.severity === 'critical').length, 0),
                  highPriorityTests: untestedPaths.filter((path) =>
                    path.priority === 'critical' || path.priority === 'high').length,
                  refactoringOpportunities: fileReviews.reduce((total, review) =>
                    total + review.refactorings.suggestions.length, 0)
                };
                report.metadata = {
                  ...report.metadata,
                  analyzedAt: new Date().toISOString(),
                  duration: Date.now() - startedAt
                };
                return report;
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
          }), this.options.timeoutMs ?? 900000);
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
