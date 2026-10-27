import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CodeQualityResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  TestCoverageResultSchema
} from '../src/types/index.js';

const codeQuality = {
  file: 'src/app.ts',
  issues: [],
  overallScore: 100,
  summary: 'No significant quality issues found.'
};

const testCoverage = {
  file: 'src/app.ts',
  hasTests: true,
  testFiles: ['tests/app.test.ts'],
  untestedPaths: [],
  coverageEstimate: 100,
  summary: 'Changed behavior is covered by tests.'
};

const refactorings = {
  file: 'src/app.ts',
  suggestions: [],
  summary: 'No refactoring required.'
};

const report = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [{ file: 'src/app.ts', codeQuality, testCoverage, refactorings }],
  summary: {
    totalFiles: 1,
    overallScore: 100,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0
  },
  recommendations: [],
  metadata: {
    analyzedAt: '2026-10-27T00:00:00.000Z',
    duration: 100,
    agentVersions: { orchestrator: '1.0.0' }
  }
};

describe('analysis schemas', () => {
  it('accepts valid code quality results and boundary scores', () => {
    expect(CodeQualityResultSchema.parse(codeQuality)).toEqual(codeQuality);
    expect(CodeQualityResultSchema.parse({ ...codeQuality, overallScore: 0 }).overallScore).toBe(0);
    expect(CodeQualityResultSchema.parse({ ...codeQuality, overallScore: 100 }).overallScore).toBe(100);
  });

  it('rejects invalid quality severities, missing fields, and out-of-range scores', () => {
    expect(() => CodeQualityResultSchema.parse({ ...codeQuality, overallScore: 101 })).toThrow();
    expect(() => CodeQualityResultSchema.parse({ ...codeQuality, summary: undefined })).toThrow();
    expect(() => CodeQualityResultSchema.parse({
      ...codeQuality,
      issues: [{ line: 1, severity: 'urgent', category: 'security', description: 'x', suggestion: 'y' }]
    })).toThrow();
  });

  it('accepts empty test lists and rejects malformed coverage results', () => {
    expect(TestCoverageResultSchema.parse(testCoverage).untestedPaths).toEqual([]);
    expect(() => TestCoverageResultSchema.parse({ ...testCoverage, hasTests: 'yes' })).toThrow();
    expect(() => TestCoverageResultSchema.parse({ ...testCoverage, coverageEstimate: -1 })).toThrow();
  });

  it('accepts valid refactoring results and rejects invalid suggestion types', () => {
    expect(RefactoringSuggestionSchema.parse(refactorings).suggestions).toEqual([]);
    expect(() => RefactoringSuggestionSchema.parse({
      ...refactorings,
      suggestions: [{ type: 'rewrite', location: 'src/app.ts' }]
    })).toThrow();
  });

  it('validates complete review reports and rejects missing required fields', () => {
    expect(ReviewReportSchema.parse(report)).toEqual(report);
    expect(() => ReviewReportSchema.parse({ ...report, summary: undefined })).toThrow();
  });

  it('exports a JSON Schema with required report properties', () => {
    const jsonSchema = zodToJsonSchema(ReviewReportSchema, { $refStrategy: 'root' }) as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(jsonSchema.required).toEqual(expect.arrayContaining([
      'pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'
    ]));
    expect(jsonSchema.properties).toHaveProperty('pullRequest');
    expect(jsonSchema.properties).toHaveProperty('fileReviews');
  });
});