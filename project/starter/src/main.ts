import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/index.js';

dotenv.config();

function validateInputs(owner: string | undefined, repo: string | undefined, prStr: string | undefined) {
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev -- <owner> <repo> <pr-number>');
    process.exit(1);
  }

  if (!/^[1-9]\d*$/.test(prStr)) {
    console.error('PR number must be a positive integer.');
    process.exit(1);
  }

  const prNumber = Number(prStr);
  if (!Number.isSafeInteger(prNumber)) {
    console.error('PR number must be a positive safe integer.');
    process.exit(1);
  }

  return { owner, repo, prNumber };
}

function validateAuthentication() {
  const hasAnthropicApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );

  const hasAwsRegion = Boolean(process.env.AWS_REGION);

  if (hasAnthropicApiKey) {
    console.log('🔐 Using Anthropic API authentication');
    return 'anthropic';
  }

  if (hasAwsCredentials && hasAwsRegion) {
    console.log('🔐 Using AWS Bedrock authentication');
    return 'aws';
  }

  console.error('Authentication required. Set one of the following:');
  console.error('  - ANTHROPIC_API_KEY');
  console.error('  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION');
  process.exit(1);
}

function validateModel() {
  const model = process.env.ANTHROPIC_MODEL;

  if (!model) {
    console.error('ANTHROPIC_MODEL is required. Example values:');
    console.error('  - Anthropic API: claude-sonnet-4-5-20250929');
    console.error('  - AWS Bedrock: us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }

  const isAnthropicApiModel = /^claude-[a-z0-9-]+$/.test(model);
  const isBedrockModel = /^(?:[a-z0-9-]+\.)?anthropic\.claude-[a-z0-9-]+-v\d+:\d+$/.test(model);
  if (!isAnthropicApiModel && !isBedrockModel) {
    console.error('ANTHROPIC_MODEL format is invalid. Use an Anthropic model ID (claude-sonnet-4-5-20250929) or a Bedrock model ID (us.anthropic.claude-sonnet-4-5-20250929-v1:0).');
    process.exit(1);
  }

  return model;
}

async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);
  const { owner: validOwner, repo: validRepo, prNumber } = validateInputs(owner, repo, prStr);
  validateAuthentication();
  validateModel();

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(validOwner, validRepo, prNumber);

    const generator = new ReportGenerator();
    const outputDir = path.resolve(process.cwd(), 'reports');
    fs.mkdirSync(outputDir, { recursive: true });

    const fileBase = `${validOwner}_${validRepo}_${prNumber}`;
    const markdownPath = path.join(outputDir, `${fileBase}.md`);
    const htmlPath = path.join(outputDir, `${fileBase}.html`);
    const jsonPath = path.join(outputDir, `${fileBase}.json`);

    fs.writeFileSync(markdownPath, generator.generateMarkdownReport(report), 'utf8');
    fs.writeFileSync(htmlPath, generator.generateHTMLReport(report), 'utf8');
    fs.writeFileSync(jsonPath, generator.generateJSONReport(report), 'utf8');

    console.log(`✅ Review complete for ${validOwner}/${validRepo}#${prNumber}`);
    console.log(`📄 Reports saved to ${outputDir}`);
    console.log(`   - ${path.basename(markdownPath)}`);
    console.log(`   - ${path.basename(htmlPath)}`);
    console.log(`   - ${path.basename(jsonPath)}`);
  } catch (error) {
    console.error('Error generating review report:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
