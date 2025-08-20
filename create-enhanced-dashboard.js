#!/usr/bin/env node
// Enhanced Dashboard Creator with Multi-Site Support
// Handles single endpoint, multi-endpoint, and multi-site API test results

import fs from 'fs';

function generateMultiSiteDashboard(resultsArray, outputFile = 'results-dashboard-autoload.html') {
    const allFiles = fs.readdirSync('.')
        .filter(file => file.match(/^(api-responses|multi-endpoint-api-responses|multi-site-api-responses)-\d+\.json$/))
        .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Testing Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .dashboard { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px;
        }
        
        .header {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .header h1 {
            color: #2c3e50;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .header .subtitle {
            color: #7f8c8d;
            font-size: 1.2em;
        }
        
        .nav-tabs {
            display: flex;
            background: white;
            border-radius: 12px;
            padding: 5px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .nav-tab {
            flex: 1;
            padding: 15px;
            text-align: center;
            background: transparent;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.3s ease;
            color: #7f8c8d;
        }
        
        .nav-tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .result-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }
        
        .result-card:hover {
            transform: translateY(-5px);
        }
        
        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }
        
        .result-title {
            font-size: 1.3em;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .result-url {
            font-size: 0.9em;
            color: #7f8c8d;
            word-break: break-all;
        }
        
        .result-timestamp {
            font-size: 0.8em;
            color: #95a5a6;
            text-align: right;
        }
        
        .stats-row {
            display: flex;
            justify-content: space-around;
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .stat {
            text-align: center;
        }
        
        .stat-number {
            font-size: 2em;
            font-weight: 700;
            margin-bottom: 5px;
        }
        
        .stat-number.success { color: #27ae60; }
        .stat-number.error { color: #e74c3c; }
        .stat-number.total { color: #3498db; }
        
        .stat-label {
            font-size: 0.9em;
            color: #7f8c8d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .site-summary {
            background: white;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        
        .site-nav {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .site-nav-item {
            padding: 8px 16px;
            background: #ecf0f1;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
        }
        
        .site-nav-item:hover {
            background: #667eea;
            color: white;
        }
        
        .site-nav-item.active {
            background: #764ba2;
            color: white;
        }
        
        .page-results {
            display: none;
        }
        
        .page-results.active {
            display: block;
        }
        
        .test-item {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 0;
            margin: 10px 0;
            border-left: 4px solid #bdc3c7;
            overflow: hidden;
        }
        
        .test-item.success { border-left-color: #27ae60; }
        .test-item.error { border-left-color: #e74c3c; }
        .test-item.warning { border-left-color: #f39c12; }
        
        .test-header {
            padding: 15px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: transparent;
            transition: background 0.2s;
        }
        
        .test-header:hover {
            background: rgba(0,0,0,0.02);
        }
        
        .test-summary {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }
        
        .test-method {
            font-weight: 600;
            color: #2c3e50;
            background: #ecf0f1;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
        }
        
        .test-status {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: 600;
        }
        
        .test-status.success {
            background: #d5f4e6;
            color: #27ae60;
        }
        
        .test-status.warning {
            background: #fef9e7;
            color: #f39c12;
        }
        
        .test-status.error {
            background: #fadbd8;
            color: #e74c3c;
        }
        
        .test-scenario {
            color: #34495e;
            font-weight: 500;
        }
        
        .response-time {
            font-size: 0.8em;
            color: #7f8c8d;
            background: #ecf0f1;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        .toggle-icon {
            color: #7f8c8d;
            font-size: 0.8em;
            transition: transform 0.3s;
        }
        
        .toggle-icon.expanded {
            transform: rotate(180deg);
        }
        
        .test-details {
            border-top: 1px solid #ecf0f1;
            padding: 15px;
            background: #ffffff;
        }
        
        .test-section {
            margin-bottom: 15px;
        }
        
        .test-section h4 {
            margin: 0 0 8px 0;
            color: #2c3e50;
            font-size: 0.9em;
        }
        
        .code-block {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 10px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.8em;
            line-height: 1.4;
        }
        
        .code-block.error {
            background: #fdedec;
            border-color: #e74c3c;
            color: #c0392b;
        }
        
        .code-block pre {
            margin: 5px 0;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        .code-block strong {
            color: #2c3e50;
        }
        
        .no-results {
            text-align: center;
            padding: 60px 20px;
            color: #7f8c8d;
            font-size: 1.2em;
        }
        
        .older-results-info {
            text-align: center;
            padding: 20px;
            margin-top: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            color: #6c757d;
        }
        
        .older-results-info em {
            font-style: italic;
        }
        
        @media (max-width: 768px) {
            .dashboard { padding: 10px; }
            .header { padding: 20px; }
            .header h1 { font-size: 2em; }
            .results-grid { grid-template-columns: 1fr; }
            .stats-row { flex-direction: column; gap: 15px; }
            .site-nav { justify-content: center; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🧪 API Testing Dashboard</h1>
            <div class="subtitle">Real-time API Response Testing & Validation</div>
        </div>
        
        <div class="nav-tabs">
            <button class="nav-tab active" onclick="showTab('single')">Latest Single Test</button>
            <button class="nav-tab" onclick="showTab('sites')">Multi-Site Results</button>
        </div>`;

    // Single endpoint results tab
    html += generateSingleTab(allFiles);
    
    // Multi-site results tab
    html += generateSiteTab(allFiles);

    html += `
    </div>

    <script>
        function showTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Hide all nav tabs active state
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected tab
            document.getElementById(tabName + '-tab').classList.add('active');
            document.querySelector('[onclick="showTab(\\''+tabName+'\\')"]').classList.add('active');
        }
        
        function toggleTestDetails(testId) {
            const details = document.getElementById(testId);
            const header = details.previousElementSibling;
            const icon = header.querySelector('.toggle-icon');
            
            if (details.style.display === 'none') {
                details.style.display = 'block';
                icon.classList.add('expanded');
            } else {
                details.style.display = 'none';
                icon.classList.remove('expanded');
            }
        }
        
        function showSitePage(siteIndex, pageIndex) {
            // Hide all page results
            document.querySelectorAll('.page-results').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav items
            document.querySelectorAll('.site-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show selected page
            const pageElement = document.getElementById('site-' + siteIndex + '-page-' + pageIndex);
            const navElement = document.getElementById('site-' + siteIndex + '-nav-' + pageIndex);
            
            if (pageElement) pageElement.classList.add('active');
            if (navElement) navElement.classList.add('active');
        }
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
        
        // Show first site page by default when sites tab is active
        document.addEventListener('DOMContentLoaded', () => {
            const firstSitePage = document.querySelector('.page-results');
            const firstNavItem = document.querySelector('.site-nav-item');
            if (firstSitePage) firstSitePage.classList.add('active');
            if (firstNavItem) firstNavItem.classList.add('active');
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(outputFile, html);
    console.log(`📊 Enhanced dashboard created: ${outputFile}`);
    return outputFile;
}

function generateSingleTab(allFiles) {
    const singleFiles = allFiles.filter(file => 
        file.match(/^api-responses-\d+\.json$/) && !file.includes('multi')
    ).sort((a, b) => {
        // Sort by timestamp in filename (most recent first)
        const aTime = parseInt(a.match(/api-responses-(\d+)\.json$/)?.[1] || '0');
        const bTime = parseInt(b.match(/api-responses-(\d+)\.json$/)?.[1] || '0');
        return bTime - aTime;
    });

    let html = `
        <div id="single-tab" class="tab-content active">
            <div class="site-summary">
                <h2>🎯 Latest Single Endpoint Test</h2>
                <p>Most recent API endpoint testing result</p>
            </div>`;

    if (singleFiles.length === 0) {
        html += '<div class="no-results">No single endpoint results found. Run the scraper in single page mode first.</div>';
    } else {
        html += '<div class="results-grid">';
        
        // Only show the latest result (first in sorted array)
        const latestFile = singleFiles[0];
        try {
            const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
            html += generateResultCard(data, latestFile);
        } catch (error) {
            console.error(`Error reading ${latestFile}:`, error.message);
            html += '<div class="no-results">Error loading latest results.</div>';
        }
        
        html += '</div>';
        
        // Show info about older results if they exist
        if (singleFiles.length > 1) {
            html += `<div class="older-results-info">
                <p><em>Note: ${singleFiles.length - 1} older result${singleFiles.length > 2 ? 's' : ''} available. Only showing the most recent test.</em></p>
            </div>`;
        }
    }

    html += '</div>';
    return html;
}

function generateSiteTab(allFiles) {
    const siteFiles = allFiles.filter(file => 
        file.match(/^multi-site-api-responses-\d+\.json$/)
    ).sort((a, b) => {
        // Sort by timestamp in filename (most recent first)
        const aTime = parseInt(a.match(/multi-site-api-responses-(\d+)\.json$/)?.[1] || '0');
        const bTime = parseInt(b.match(/multi-site-api-responses-(\d+)\.json$/)?.[1] || '0');
        return bTime - aTime;
    });

    let html = `
        <div id="sites-tab" class="tab-content">
            <div class="site-summary">
                <h2>🌐 Latest Multi-Site Results</h2>
                <p>Most recent full site crawl with comprehensive API testing</p>
            </div>`;

    if (siteFiles.length === 0) {
        html += '<div class="no-results">No multi-site results found. Run the scraper in full site mode first.</div>';
    } else {
        // Only show the latest result (first in sorted array)
        const latestFile = siteFiles[0];
        try {
            const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
            html += generateSiteResultCard(data, latestFile, 0);
        } catch (error) {
            console.error(`Error reading ${latestFile}:`, error.message);
            html += '<div class="no-results">Error loading latest multi-site results.</div>';
        }
        
        // Show info about older results if they exist
        if (siteFiles.length > 1) {
            html += `<div class="older-results-info">
                <p><em>Note: ${siteFiles.length - 1} older multi-site result${siteFiles.length > 2 ? 's' : ''} available. Only showing the most recent crawl.</em></p>
            </div>`;
        }
    }

    html += '</div>';
    return html;
}

function generateResultCard(data, filename) {
    // Handle both single endpoint and multi-endpoint formats
    const originalResponses = data.endpoint?.responses || [];
    const tests = data.tests || originalResponses.map(response => ({
        method: response.request?.method || 'POST',
        statusCode: response.response?.status || response.statusCode,
        scenario: `${response.statusCode} Test`,
        error: response.error || (response.response && !response.response.matched),
        // Add detailed information
        request: response.request,
        response: response.response,
        timestamp: response.timestamp,
        expectedStatus: response.statusCode
    }));
    
    const successCount = tests.filter(test => !test.error && test.statusCode).length;
    const errorCount = tests.length - successCount;
    
    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Unknown';
    
    return `
        <div class="result-card">
            <div class="result-header">
                <div>
                    <div class="result-title">${data.endpoint?.requestDetails?.method || data.endpoint?.endpoint?.mode || 'API'} ${data.endpoint?.requestDetails?.path || data.endpoint?.endpoint?.url?.split('/').pop() || 'Endpoint'}</div>
                    <div class="result-url">${data.endpoint?.endpoint?.url || data.endpoint?.url || filename}</div>
                </div>
                <div class="result-timestamp">${timestamp}</div>
            </div>
            
            <div class="stats-row">
                <div class="stat">
                    <div class="stat-number total">${tests.length}</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat">
                    <div class="stat-number success">${successCount}</div>
                    <div class="stat-label">Success</div>
                </div>
                <div class="stat">
                    <div class="stat-number error">${errorCount}</div>
                    <div class="stat-label">Errors</div>
                </div>
            </div>
            
            <div class="test-results">
                ${tests.map((test, index) => {
                    // Calculate response time from headers or use timestamp
                    let responseTime = 'N/A';
                    if (test.response?.headers?.['x-envoy-upstream-service-time']) {
                        responseTime = `${test.response.headers['x-envoy-upstream-service-time']}ms`;
                    } else if (test.timestamp) {
                        // Fallback: show timestamp
                        responseTime = new Date(test.timestamp).toLocaleTimeString();
                    }
                    
                    const isMatched = test.statusCode && test.expectedStatus && 
                                    test.statusCode.toString() === test.expectedStatus.toString();
                    
                    return `
                    <div class="test-item ${test.error ? 'error' : (isMatched ? 'success' : 'warning')}">
                        <div class="test-header" onclick="toggleTestDetails('test-${index}')">
                            <div class="test-summary">
                                <span class="test-method">${test.method || 'GET'}</span>
                                <span class="test-status ${test.error ? 'error' : (isMatched ? 'success' : 'warning')}">
                                    ${test.statusCode || (test.error ? 'ERROR' : 'SUCCESS')}
                                </span>
                                <span class="test-scenario">${test.scenario || test.error || 'Success'}</span>
                                <span class="response-time">${responseTime}</span>
                            </div>
                            <span class="toggle-icon">▼</span>
                        </div>
                        <div class="test-details" id="test-${index}" style="display: none;">
                            ${test.request ? `
                                <div class="test-section">
                                    <h4>📤 Request</h4>
                                    <div class="code-block">
                                        <div><strong>URL:</strong> ${test.request.url || 'N/A'}</div>
                                        <div><strong>Method:</strong> ${test.request.method || 'N/A'}</div>
                                        ${test.request.headers ? `
                                            <div><strong>Headers:</strong></div>
                                            <pre>${JSON.stringify(test.request.headers, null, 2)}</pre>
                                        ` : ''}
                                        ${test.request.body && test.request.body !== 'null' ? `
                                            <div><strong>Body:</strong></div>
                                            <pre>${test.request.body}</pre>
                                        ` : ''}
                                    </div>
                                </div>
                            ` : ''}
                            ${test.response ? `
                                <div class="test-section">
                                    <h4>📥 Response</h4>
                                    <div class="code-block">
                                        <div><strong>Status:</strong> ${test.response.status} ${test.response.statusText || ''}</div>
                                        <div><strong>Expected:</strong> ${test.expectedStatus}</div>
                                        <div><strong>Match:</strong> ${isMatched ? '✅ Yes' : '⚠️ No'}</div>
                                        ${test.response.headers ? `
                                            <div><strong>Key Headers:</strong></div>
                                            <pre>${JSON.stringify({
                                                'content-type': test.response.headers['content-type'],
                                                'x-envoy-upstream-service-time': test.response.headers['x-envoy-upstream-service-time'],
                                                'date': test.response.headers.date,
                                                'server': test.response.headers.server
                                            }, null, 2)}</pre>
                                        ` : ''}
                                        ${test.response.body && typeof test.response.body === 'object' ? `
                                            <div><strong>Response Body:</strong></div>
                                            <pre>${JSON.stringify(test.response.body, null, 2).substring(0, 500)}${JSON.stringify(test.response.body, null, 2).length > 500 ? '...' : ''}</pre>
                                        ` : test.response.body && typeof test.response.body === 'string' ? `
                                            <div><strong>Response Body:</strong></div>
                                            <pre>${test.response.body.substring(0, 300)}${test.response.body.length > 300 ? '...' : ''}</pre>
                                        ` : ''}
                                    </div>
                                </div>
                            ` : ''}
                            ${test.error ? `
                                <div class="test-section">
                                    <h4>❌ Error</h4>
                                    <div class="code-block error">
                                        ${test.error}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>`
                }).join('')}
            </div>
        </div>`;
}

function generateSiteResultCard(data, filename, siteIndex) {
    const pages = data.pages || [];
    const totalTests = data.totalTests || 0;
    const totalSuccessful = data.totalSuccessful || 0;
    const totalErrors = data.totalErrors || 0;
    
    let html = `
        <div class="result-card">
            <div class="result-header">
                <div>
                    <div class="result-title">🌐 ${new URL(data.startUrl).hostname}</div>
                    <div class="result-url">${data.startUrl}</div>
                </div>
                <div class="result-timestamp">${new Date(data.crawlTimestamp).toLocaleString()}</div>
            </div>
            
            <div class="stats-row">
                <div class="stat">
                    <div class="stat-number total">${pages.length}</div>
                    <div class="stat-label">Pages</div>
                </div>
                <div class="stat">
                    <div class="stat-number total">${totalTests}</div>
                    <div class="stat-label">Tests</div>
                </div>
                <div class="stat">
                    <div class="stat-number success">${totalSuccessful}</div>
                    <div class="stat-label">Success</div>
                </div>
                <div class="stat">
                    <div class="stat-number error">${totalErrors}</div>
                    <div class="stat-label">Errors</div>
                </div>
            </div>
            
            <div class="site-nav">`;
    
    pages.forEach((page, pageIndex) => {
        html += `
            <div class="site-nav-item" id="site-${siteIndex}-nav-${pageIndex}" 
                 onclick="showSitePage(${siteIndex}, ${pageIndex})">
                ${page.pageTitle || `Page ${pageIndex + 1}`}
            </div>`;
    });
    
    html += '</div>';
    
    // Add page results
    pages.forEach((page, pageIndex) => {
        const pageTests = page.tests || [];
        html += `
            <div class="page-results" id="site-${siteIndex}-page-${pageIndex}">
                <h4>${page.pageTitle}</h4>
                <div class="test-results">
                    ${pageTests.map((test, testIndex) => {
                        // Calculate response time from headers or use timestamp
                        let responseTime = 'N/A';
                        if (test.headers?.['x-envoy-upstream-service-time']) {
                            responseTime = `${test.headers['x-envoy-upstream-service-time']}ms`;
                        } else if (page.timestamp) {
                            responseTime = new Date(page.timestamp).toLocaleTimeString();
                        }
                        
                        const isMatched = test.statusCode && test.expected && 
                                        test.statusCode.toString() === test.expected.toString();
                        
                        return `
                        <div class="test-item ${test.error ? 'error' : (isMatched ? 'success' : 'warning')}">
                            <div class="test-header" onclick="toggleTestDetails('site-${siteIndex}-page-${pageIndex}-test-${testIndex}')">
                                <div class="test-summary">
                                    <span class="test-method">${test.method || 'GET'}</span>
                                    <span class="test-status ${test.error ? 'error' : (isMatched ? 'success' : 'warning')}">
                                        ${test.statusCode || (test.error ? 'ERROR' : 'SUCCESS')}
                                    </span>
                                    <span class="test-scenario">${test.scenario || test.error || 'Success'}</span>
                                    <span class="response-time">${responseTime}</span>
                                </div>
                                <span class="toggle-icon">▼</span>
                            </div>
                            <div class="test-details" id="site-${siteIndex}-page-${pageIndex}-test-${testIndex}" style="display: none;">
                                <div class="test-section">
                                    <h4>📤 Request</h4>
                                    <div class="code-block">
                                        <div><strong>URL:</strong> ${page.pageUrl || 'N/A'}</div>
                                        <div><strong>Method:</strong> ${test.method || 'N/A'}</div>
                                        <div><strong>Expected Status:</strong> ${test.expected || 'N/A'}</div>
                                    </div>
                                </div>
                                <div class="test-section">
                                    <h4>📥 Response</h4>
                                    <div class="code-block">
                                        <div><strong>Status:</strong> ${test.status || test.statusCode} ${test.statusText || ''}</div>
                                        <div><strong>Expected:</strong> ${test.expected}</div>
                                        <div><strong>Match:</strong> ${isMatched ? '✅ Yes' : '⚠️ No'}</div>
                                        ${test.headers ? `
                                            <div><strong>Key Headers:</strong></div>
                                            <pre>${JSON.stringify({
                                                'content-type': test.headers['content-type'],
                                                'x-envoy-upstream-service-time': test.headers['x-envoy-upstream-service-time'],
                                                'date': test.headers.date,
                                                'server': test.headers.server || test.headers['x-content-type-options']
                                            }, null, 2)}</pre>
                                        ` : ''}
                                        ${test.body && typeof test.body === 'object' ? `
                                            <div><strong>Response Body:</strong></div>
                                            <pre>${JSON.stringify(test.body, null, 2).substring(0, 500)}${JSON.stringify(test.body, null, 2).length > 500 ? '...' : ''}</pre>
                                        ` : test.body && typeof test.body === 'string' ? `
                                            <div><strong>Response Body:</strong></div>
                                            <pre>${test.body.substring(0, 300)}${test.body.length > 300 ? '...' : ''}</pre>
                                        ` : ''}
                                    </div>
                                </div>
                                ${test.error ? `
                                    <div class="test-section">
                                        <h4>❌ Error</h4>
                                        <div class="code-block error">
                                            ${test.error}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>`
                    }).join('')}
                </div>
            </div>`;
    });
    
    html += '</div>';
    return html;
}

// Export the main function
export { generateMultiSiteDashboard };

// If run directly
if (process.argv[1].endsWith('create-enhanced-dashboard.js')) {
    generateMultiSiteDashboard();
}
