#!/usr/bin/env node
// Headless batch entrypoint for CI/CD pipelines.
//
// Unlike server.js (which serves the interactive dashboard for a human to drive
// one URL at a time), this script validates a list of developer-portal URLs
// end-to-end with no browser/UI involved, and reports results in machine-readable
// formats (JSON + JUnit XML) with process exit codes a pipeline can act on:
//
//   0 - every tracked endpoint passed
//   1 - the tool ran successfully but found one or more documentation/API mismatches
//   2 - the tool itself failed to run (bad config, missing credentials, crash, timeout)
//
// Usage:
//   node cli.js                                   # validates every URL in endpoints.json
//   node cli.js --url <docs-url>                   # validates a single URL
//   node cli.js --urls-file path/to/endpoints.json # validates a custom list
//   node cli.js --extract-only                     # skip live sandbox API testing
//   node cli.js --out results/report.json --junit results/report.junit.xml
//
// See README.md for the full flag reference and pipeline integration guide.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractFromUrl, testAllSnippets } from './lib/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXIT_OK = 0;
const EXIT_VALIDATION_FAILURE = 1;
const EXIT_INFRA_ERROR = 2;

const DEFAULT_ENDPOINTS_FILE = path.join(__dirname, 'endpoints.json');
const DEFAULT_PER_URL_TIMEOUT_MS = 180_000; // generous: extraction + live tests can involve many status-code scenarios
const DEFAULT_GLOBAL_TIMEOUT_MS = 30 * 60_000; // hard ceiling so a hung run can't wedge a pipeline job forever

function printHelp() {
    console.log(`GP API Validator - CI/CD batch entrypoint

Usage: node cli.js [options]

Options:
  --url <docs-url>            Validate a single Global Payments developer portal URL
  --urls-file <path>          JSON file listing URLs to validate (default: endpoints.json)
  --extract-only              Skip live sandbox API testing; only verify the docs page can be parsed
  --out <path>                Write the JSON report here (default: results/report-<timestamp>.json)
  --junit <path>               Write a JUnit XML report here (default: results/report-<timestamp>.junit.xml)
  --no-junit                  Skip writing a JUnit report
  --timeout-ms <n>             Per-URL timeout in milliseconds (default: ${DEFAULT_PER_URL_TIMEOUT_MS})
  --global-timeout-ms <n>       Whole-run watchdog timeout in milliseconds (default: ${DEFAULT_GLOBAL_TIMEOUT_MS})
  --report-only                Always exit 0, even if validation failures were found (use for informational/nightly runs)
  --quiet                      Suppress the underlying scraper/tester's verbose per-step logging
  -h, --help                   Show this help text
`);
}

function parseArgs(argv) {
    const args = {
        url: null,
        urlsFile: null,
        extractOnly: false,
        out: null,
        junit: null,
        noJunit: false,
        timeoutMs: DEFAULT_PER_URL_TIMEOUT_MS,
        globalTimeoutMs: DEFAULT_GLOBAL_TIMEOUT_MS,
        reportOnly: false,
        quiet: false,
        help: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--url':
                args.url = argv[++i];
                break;
            case '--urls-file':
                args.urlsFile = argv[++i];
                break;
            case '--extract-only':
                args.extractOnly = true;
                break;
            case '--out':
                args.out = argv[++i];
                break;
            case '--junit':
                args.junit = argv[++i];
                break;
            case '--no-junit':
                args.noJunit = true;
                break;
            case '--timeout-ms':
                args.timeoutMs = Number(argv[++i]);
                break;
            case '--global-timeout-ms':
                args.globalTimeoutMs = Number(argv[++i]);
                break;
            case '--report-only':
                args.reportOnly = true;
                break;
            case '--quiet':
                args.quiet = true;
                break;
            case '-h':
            case '--help':
                args.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

async function loadUrlList(args) {
    if (args.url) {
        return [{ name: args.url, url: args.url, liveTest: !args.extractOnly }];
    }

    const urlsFilePath = args.urlsFile
        ? path.resolve(process.cwd(), args.urlsFile)
        : DEFAULT_ENDPOINTS_FILE;

    let raw;
    try {
        raw = await fs.readFile(urlsFilePath, 'utf8');
    } catch (error) {
        throw new Error(`Could not read URL list from ${urlsFilePath}: ${error.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`${urlsFilePath} is not valid JSON: ${error.message}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error(`${urlsFilePath} must contain a JSON array of URLs or {name, url, liveTest} entries`);
    }

    if (parsed.length === 0) {
        throw new Error(`${urlsFilePath} does not list any URLs to validate`);
    }

    return parsed.map(entry => {
        if (typeof entry === 'string') {
            return { name: entry, url: entry, liveTest: !args.extractOnly };
        }
        if (!entry || typeof entry.url !== 'string') {
            throw new Error(`${urlsFilePath} contains an entry without a "url" string: ${JSON.stringify(entry)}`);
        }
        return {
            name: entry.name || entry.url,
            url: entry.url,
            liveTest: args.extractOnly ? false : entry.liveTest !== false
        };
    });
}

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Flattens the nested extraction/testAllSnippets output into a simple list of
// human-readable failure strings, so both the console summary and the JUnit
// report can share one notion of "what actually went wrong" for a URL.
function collectFailures(extractedData, testResults) {
    const failures = [];

    if (!extractedData?.method || !extractedData?.url) {
        failures.push('Extraction failed: could not determine the request method/URL from the documentation page');
        return failures; // nothing else to check if extraction itself failed
    }

    if (!testResults) {
        return failures;
    }

    for (const [exampleName, exampleResult] of Object.entries(testResults.exampleTests || {})) {
        for (const [code, codeResult] of Object.entries(exampleResult.statusCodeTests || {})) {
            if (codeResult.skipped) continue;
            if (!codeResult.matched) {
                failures.push(
                    `[${exampleName}] ${codeResult.scenario || code}: expected ${codeResult.expectedCode}, got ${codeResult.actualCode}` +
                    (codeResult.contentValidationNote ? ` (${codeResult.contentValidationNote})` : '')
                );
            }
        }
    }

    for (const verification of testResults.sdkVerifications || []) {
        if (!verification.verified) {
            failures.push(`SDK verification failed for ${verification.language} (${verification.sdk}): ${verification.error || verification.message || 'unknown error'}`);
        }
    }

    return failures;
}

async function validateOneUrl(entry, args) {
    const startedAt = Date.now();
    const result = {
        name: entry.name,
        url: entry.url,
        liveTest: entry.liveTest,
        status: 'passed', // passed | failed | errored
        durationMs: 0,
        failures: [],
        error: null
    };

    try {
        const extractedData = await withTimeout(extractFromUrl(entry.url), args.timeoutMs, `Extraction of ${entry.url}`);

        let testResults = null;
        if (entry.liveTest && extractedData.method && extractedData.url) {
            testResults = await withTimeout(testAllSnippets(extractedData), args.timeoutMs, `Live testing of ${entry.url}`);
        }

        result.failures = collectFailures(extractedData, testResults);
        result.status = result.failures.length > 0 ? 'failed' : 'passed';
    } catch (error) {
        result.status = 'errored';
        result.error = error.message;
    } finally {
        result.durationMs = Date.now() - startedAt;
    }

    return result;
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildJUnitReport(results) {
    const failureCount = results.filter(r => r.status === 'failed').length;
    const errorCount = results.filter(r => r.status === 'errored').length;
    const totalTimeSeconds = results.reduce((sum, r) => sum + r.durationMs, 0) / 1000;

    const testcases = results.map(r => {
        const timeSeconds = (r.durationMs / 1000).toFixed(3);
        const nameAttr = xmlEscape(r.name);
        if (r.status === 'passed') {
            return `    <testcase classname="gp-api-validator" name="${nameAttr}" time="${timeSeconds}" />`;
        }
        if (r.status === 'errored') {
            return `    <testcase classname="gp-api-validator" name="${nameAttr}" time="${timeSeconds}">
      <error message="${xmlEscape(r.error || 'Unknown error')}" />
    </testcase>`;
        }
        const failureMessage = xmlEscape(r.failures.join('; '));
        const failureBody = xmlEscape(r.failures.join('\n'));
        return `    <testcase classname="gp-api-validator" name="${nameAttr}" time="${timeSeconds}">
      <failure message="${failureMessage}">${failureBody}</failure>
    </testcase>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="gp-api-validator" tests="${results.length}" failures="${failureCount}" errors="${errorCount}" time="${totalTimeSeconds.toFixed(3)}">
${testcases.join('\n')}
</testsuite>
`;
}

async function ensureParentDir(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        return EXIT_OK;
    }

    const originalConsoleLog = console.log;
    if (args.quiet) {
        console.log = () => {};
    }

    let urlList;
    try {
        urlList = await loadUrlList(args);
    } catch (error) {
        console.log = originalConsoleLog;
        console.error(`❌ ${error.message}`);
        return EXIT_INFRA_ERROR;
    }

    const timestamp = Date.now();
    const outPath = args.out
        ? path.resolve(process.cwd(), args.out)
        : path.join(process.cwd(), 'results', `report-${timestamp}.json`);
    const junitPath = args.noJunit
        ? null
        : args.junit
            ? path.resolve(process.cwd(), args.junit)
            : path.join(process.cwd(), 'results', `report-${timestamp}.junit.xml`);

    console.error(`🔎 Validating ${urlList.length} URL(s)${args.extractOnly ? ' (extraction only, no live API testing)' : ''}...`);

    const results = [];
    let watchdogTimer;
    const watchdog = new Promise((_, reject) => {
        watchdogTimer = setTimeout(
            () => reject(new Error(`Pipeline run exceeded global timeout of ${args.globalTimeoutMs}ms`)),
            args.globalTimeoutMs
        );
    });

    const run = (async () => {
        // Sequential by design: extraction/testing shares a single sandbox
        // access-token file and hits a shared GP sandbox rate limit, so running
        // URLs concurrently would cause token clobbering and spurious 429s.
        for (const entry of urlList) {
            console.error(`\n▶ ${entry.name}`);
            const result = await validateOneUrl(entry, args);
            results.push(result);
            const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '💥';
            console.error(`${icon} ${entry.name} — ${result.status} (${result.durationMs}ms)`);
            if (result.status !== 'passed') {
                const detail = result.status === 'errored' ? result.error : result.failures.join('; ');
                console.error(`   ${detail}`);
            }
        }
    })();

    try {
        await Promise.race([run, watchdog]);
    } catch (error) {
        console.log = originalConsoleLog;
        console.error(`💥 ${error.message}`);
        return EXIT_INFRA_ERROR;
    } finally {
        clearTimeout(watchdogTimer);
    }

    console.log = originalConsoleLog;

    const summary = {
        total: results.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        errored: results.filter(r => r.status === 'errored').length
    };

    const report = {
        tool: 'gp-api-validator',
        timestamp: new Date(timestamp).toISOString(),
        summary,
        results
    };

    await ensureParentDir(outPath);
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    console.error(`\n💾 JSON report written to ${outPath}`);

    if (junitPath) {
        await ensureParentDir(junitPath);
        await fs.writeFile(junitPath, buildJUnitReport(results));
        console.error(`💾 JUnit report written to ${junitPath}`);
    }

    console.error(`\n📊 Summary: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.errored} errored`);

    if (summary.failed === 0 && summary.errored === 0) {
        return EXIT_OK;
    }
    if (args.reportOnly) {
        console.error('ℹ️  --report-only set: exiting 0 despite failures above');
        return EXIT_OK;
    }
    return summary.errored > 0 && summary.failed === 0 ? EXIT_INFRA_ERROR : EXIT_VALIDATION_FAILURE;
}

main()
    .then(exitCode => process.exit(exitCode))
    .catch(error => {
        console.error('💥 Unexpected CLI error:', error);
        process.exit(EXIT_INFRA_ERROR);
    });
