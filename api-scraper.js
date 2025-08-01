import { firefox } from 'playwright';
import readline from 'readline';

/**
 * Multi-Endpoint API Response Generator
 * ===================================== 
 * 
 * This scraper discovers multiple API endpoints from Global Payments documentation
 * and generates real responses using tokenized credentials for each status code scenario.
 */

/**
 * Get user input from console
 */
function getUserInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Collect URL from user input
 */
async function collectEndpointFromUser() {
    console.log('🎯 API Documentation URL Collector');
    console.log('=====================================');
    console.log('Enter API documentation URL to scrape and test.');
    console.log('Example: https://developer.globalpay.com/api/disputes#/Challenge/challengeDispute');
    console.log('');

    while (true) {
        const url = await getUserInput(`📝 Enter API documentation URL: `);
        
        // If no URL provided, force user to enter one
        if (!url) {
            console.log('❌ URL is required. Please enter a valid API documentation URL.');
            continue;
        }
        
        // Validate URL format
        if (!url.startsWith('http')) {
            console.log('❌ Invalid URL format. Please enter a complete URL starting with http:// or https://');
            continue;
        }
        
        return {
            url: url
        };
    }
}

async function generateAPIResponse() {
    console.log('🚀 API Response Generator Starting...\n');
    
    // Collect endpoint information from user
    const endpoint = await collectEndpointFromUser();
    
    if (!endpoint) {
        console.log('❌ No endpoint provided. Exiting...');
        return;
    }

    console.log(`\n🎯 Ready to test endpoint: ${endpoint.url}`);
    console.log('Press Ctrl+C to cancel at any time.');
    
    await generateAPIResponses(endpoint);
    
    // Auto-update dashboard and open results
    await updateDashboardAndOpen();
}

/**
 * Main function to generate API responses for a single endpoint
 */
async function generateAPIResponses(endpoint) {
    const { firefox } = await import('playwright');
    
    const browser = await firefox.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();

    // Configuration for tokenized credentials
    const tokenizedCredentials = {
        accessToken: "Bearer DCKbRy6gtN6gWJI2ja0B7e3POtbb", // Sandbox token
        apiVersion: "2021-03-22",
        baseUrl: "https://apis.sandbox.globalpay.com"
    };

    let endpointResults = null;

    console.log(`\n🎯 PROCESSING ENDPOINT: ${endpoint.url}`);
    console.log('='.repeat(60));

    try {
        // Navigate to the endpoint documentation
        await page.goto(endpoint.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);

        // Extract status codes and request details for this endpoint
        const statusCodes = await extractStatusCodesFromPage(page);
        const requestDetails = await extractRequestDetails(page);
        
        // Skip credential extraction from page - use our pre-configured credentials
        console.log(`📝 Using pre-configured credentials to reduce API calls`);
        
        // Use our configured credentials directly (no page extraction needed)
        const mergedCredentials = tokenizedCredentials;

        if (!requestDetails.url) {
            console.log(`⚠️ Could not extract request details for ${endpoint.url}, skipping...`);
            await browser.close();
            return;
        }

        console.log(`✅ Found ${statusCodes.length} status codes for ${endpoint.url}`);
        
        // Generate responses for each status code with optimized batching
        const endpointResponses = [];
        
        // Group status codes to reduce rapid-fire API calls
        const statusCodeBatches = [];
        const batchSize = 3; // Process 3 status codes at a time
        
        for (let i = 0; i < statusCodes.length; i += batchSize) {
            statusCodeBatches.push(statusCodes.slice(i, i + batchSize));
        }

        for (const batch of statusCodeBatches) {
            console.log(`\n📦 Processing batch: ${batch.join(', ')}`);
            
            for (const statusCode of batch) {
                console.log(`🧪 Testing ${endpoint.url} - Status Code: ${statusCode}`);
                
                try {
                    const apiRequest = prepareAPIRequest(requestDetails, mergedCredentials, statusCode, endpoint);
                    const response = await makeAPICall(apiRequest, statusCode);
                    
                    endpointResponses.push({
                        statusCode: statusCode,
                        request: apiRequest,
                        response: response,
                        timestamp: new Date().toISOString()
                    });

                    console.log(`   ✅ ${response.status} ${response.statusText}`);
                    
                } catch (error) {
                    console.log(`   ❌ Failed: ${error.message}`);
                    
                    endpointResponses.push({
                        statusCode: statusCode,
                        request: null,
                        response: null,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
                
                // Short delay between requests in same batch
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Longer delay between batches to be more API-friendly
            if (statusCodeBatches.indexOf(batch) < statusCodeBatches.length - 1) {
                console.log(`⏸️ Batch complete, waiting 2 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Store results for this endpoint
        endpointResults = {
            endpoint: endpoint,
            requestDetails: requestDetails,
            credentials: mergedCredentials, // Simplified - no page credentials
            statusCodes: statusCodes,
            responses: endpointResponses,
            summary: {
                total: endpointResponses.length,
                successful: endpointResponses.filter(r => r.response && !r.error && r.response.matched).length,
                errors: endpointResponses.filter(r => r.error || (r.response && !r.response.matched)).length
            }
        };

    } catch (error) {
        console.log(`❌ Error processing ${endpoint.url}: ${error.message}`);
        
        endpointResults = {
            endpoint: endpoint,
            error: error.message,
            responses: [],
            summary: { total: 0, successful: 0, errors: 1 }
        };
    }

    await browser.close();

    // Display comprehensive results
    displayResults(endpointResults);
    
    // Save results to file
    await saveResults(endpointResults);
}

/**
 * Enhanced request preparation that handles different endpoint types
 */
function prepareAPIRequest(requestDetails, credentials, statusCode, endpointInfo) {
    const url = requestDetails.url;
    const headers = { ...requestDetails.headers };
    const body = { ...requestDetails.body };
    
    // Only override credentials for non-auth error tests to reduce token calls
    if (statusCode !== '401' && statusCode !== '403') {
        headers.authorization = credentials.accessToken;
        headers['x-gp-version'] = credentials.apiVersion;
    }
    
    // Set standard headers only once
    headers['content-type'] = 'application/json';
    headers['accept'] = 'application/json';
    
    // Determine HTTP method based on endpoint type
    let method = 'POST'; // Default
    if (endpointInfo.url.toLowerCase().includes('get') || 
        endpointInfo.url.toLowerCase().includes('retrieve')) {
        method = 'GET';
    }
    
    // Modify request based on expected status code and endpoint type
    const modifiedRequest = modifyRequestForStatusCode(url, headers, body, statusCode, endpointInfo);
    
    return {
        url: modifiedRequest.url,
        method: method,
        headers: modifiedRequest.headers,
        body: method === 'GET' ? null : JSON.stringify(modifiedRequest.body)
    };
}

/**
 * Enhanced status code modification with endpoint-specific logic and reduced token usage
 */
function modifyRequestForStatusCode(url, headers, body, statusCode, endpointInfo) {
    const modifiedHeaders = { ...headers };
    const modifiedBody = { ...body };
    let modifiedUrl = url;
    
    // Common modifications for all endpoints - optimized to reduce API calls
    switch (statusCode) {
        case '400':
            // Bad Request - Send malformed/invalid data (no new token needed)
            if (modifiedBody && Object.keys(modifiedBody).length > 0) {
                modifiedBody.invalid_field = "invalid_data";
                delete modifiedBody.id;
                delete modifiedBody.dispute_id;
                delete modifiedBody.reference_number;
                delete modifiedBody.reason_code;
            } else {
                modifiedUrl += modifiedUrl.includes('?') ? '&invalid_param=bad_value' : '?invalid_param=bad_value';
            }
            break;
            
        case '401':
            // Unauthorized - Use a single invalid token to avoid token generation
            modifiedHeaders.authorization = "Bearer INVALID_401_TEST_TOKEN";
            break;
            
        case '403':
            // Forbidden - Use a different invalid token (no need to create valid limited token)
            modifiedHeaders.authorization = "Bearer INVALID_403_TEST_TOKEN";
            modifiedHeaders['x-test-scenario'] = 'forbidden_access';
            break;
            
        case '404':
            // Not Found - Use static non-existent resource ID
            const resourcePatterns = [
                /\/disputes\/[A-Za-z0-9_-]+/,
                /\/transactions\/[A-Za-z0-9_-]+/,
                /\/[A-Za-z0-9_-]{10,}/
            ];
            
            let urlModified = false;
            for (const pattern of resourcePatterns) {
                if (pattern.test(modifiedUrl)) {
                    modifiedUrl = modifiedUrl.replace(pattern, match => {
                        return match.replace(/[A-Za-z0-9_-]+$/, 'STATIC_404_TEST_ID');
                    });
                    urlModified = true;
                    break;
                }
            }
            
            if (!urlModified && modifiedBody && typeof modifiedBody === 'object') {
                if (modifiedBody.id) modifiedBody.id = 'STATIC_404_TEST_ID';
                if (modifiedBody.dispute_id) modifiedBody.dispute_id = 'DIS_404_TEST_ID';
                if (modifiedBody.transaction_id) modifiedBody.transaction_id = 'TXN_404_TEST_ID';
            }
            break;
            
        case '422':
            // Unprocessable Entity - Use static invalid values
            if (modifiedBody && typeof modifiedBody === 'object') {
                modifiedBody.amount = -1;
                modifiedBody.currency = "XXX"; // Invalid currency code
                modifiedBody.status = "INVALID_STATUS";
            }
            break;
            
        case '500':
        case '501':
        case '502':
        case '503':
        case '504':
            // Server errors - Use test headers to trigger errors without creating tokens
            modifiedHeaders['x-test-scenario'] = `server_error_${statusCode}`;
            modifiedHeaders['x-simulate-error'] = statusCode;
            break;
    }
    
    // Endpoint-specific optimizations
    if (endpointInfo.url.toLowerCase().includes('challenge')) {
        switch (statusCode) {
            case '400':
                modifiedBody.documents = [{ 
                    invalid_document_type: "INVALID_TYPE",
                    missing_required_field: null 
                }];
                delete modifiedBody.reason_code;
                break;
            case '404':
                modifiedUrl = modifiedUrl.replace(/disputes\/[^\/]+/, 'disputes/DIS_STATIC_404_TEST');
                break;
        }
    }
    
    return {
        url: modifiedUrl,
        headers: modifiedHeaders,
        body: modifiedBody
    };
}

/**
 * Display results for single endpoint
 */
function displayResults(endpointResult) {
    console.log('\n🎉 API RESPONSE GENERATION COMPLETE');
    console.log('===================================');
    
    const { endpoint, responses, summary } = endpointResult;
    
    console.log(`\n📍 ${endpoint.url}`);
    console.log(`📊 Tests: ${summary.total}, Successful: ${summary.successful}, Errors: ${summary.errors}`);
    
    if (responses && responses.length > 0) {
        console.log(`📋 Response Summary:`);
        
        // Group responses by status code
        const statusGroups = {};
        responses.forEach(r => {
            if (!statusGroups[r.statusCode]) {
                statusGroups[r.statusCode] = [];
            }
            statusGroups[r.statusCode].push(r);
        });
        
        Object.entries(statusGroups).forEach(([statusCode, results]) => {
            const firstResult = results[0];
            if (firstResult.error) {
                console.log(`   ${statusCode}: ❌ ERROR - ${firstResult.error}`);
            } else if (firstResult.response) {
                const match = firstResult.response.matched ? '✅' : '⚠️';
                console.log(`   ${statusCode}: ${match} Got ${firstResult.response.status} ${firstResult.response.statusText}`);
            }
        });
    }
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`🧪 Total API Calls: ${summary.total}`);
    console.log(`✅ Successful: ${summary.successful}`);
    console.log(`❌ Errors: ${summary.errors}`);
    console.log(`📊 Success Rate: ${summary.total > 0 ? Math.round((summary.successful / summary.total) * 100) : 0}%`);
}

/**
 * Save single endpoint results to file
 */
async function saveResults(endpointResult) {
    const fs = await import('fs/promises');
    
    const results = {
        timestamp: new Date().toISOString(),
        totalTests: endpointResult.summary.total,
        endpoint: endpointResult
    };
    
    const filename = `api-responses-${Date.now()}.json`;
    
    try {
        await fs.writeFile(filename, JSON.stringify(results, null, 2));
        console.log(`\n💾 Results saved to: ${filename}`);
    } catch (error) {
        console.log(`⚠️ Could not save results to file: ${error.message}`);
    }
}

// Import the helper functions from our existing code
async function extractStatusCodesFromPage(page) {
    console.log('🔍 Enhanced status code extraction from documentation...');
    
    const statusCodesWithDescriptions = [];
    
    try {
        // Method 1: Extract from documented responses section
        const documentedResponses = await extractDocumentedResponses(page);
        
        // Method 2: Extract from status code dropdowns  
        const dropdownCodes = await extractStatusCodeDropdowns(page);
        
        // Method 3: Fallback to original method for backwards compatibility
        const fallbackCodes = await extractStatusCodesOriginal(page);
        
        // Combine and deduplicate
        const allCodes = [...documentedResponses, ...dropdownCodes, ...fallbackCodes.map(code => ({ code, description: null }))];
        const uniqueCodes = allCodes.filter((codeInfo, index, array) => 
            array.findIndex(c => c.code === codeInfo.code) === index
        );
        
        console.log(`✅ Found ${uniqueCodes.length} documented status codes:`);
        uniqueCodes.forEach(codeInfo => {
            console.log(`   ${codeInfo.code}: ${codeInfo.description || 'No description'}`);
            statusCodesWithDescriptions.push(codeInfo);
        });
        
        // Return just the codes for backwards compatibility, but store descriptions globally
        global.statusCodeDescriptions = statusCodesWithDescriptions;
        return uniqueCodes.map(c => c.code).sort((a, b) => parseInt(a) - parseInt(b));
        
    } catch (error) {
        console.log(`Warning: Error in enhanced extraction, falling back: ${error.message}`);
        return await extractStatusCodesOriginal(page);
    }
}

async function extractDocumentedResponses(page) {
    const responses = [];
    
    try {
        // Look for response sections in the API documentation
        await page.waitForTimeout(1000);
        
        // Try to find response buttons/tabs
        const responseButtons = await page.locator('button').filter({ 
            hasText: /\d{3}\s+(Success|Created|Bad Request|Unauthorized|Forbidden|Not Found|Server Error)/ 
        }).all();
        
        console.log(`   Found ${responseButtons.length} response buttons`);
        
        for (const button of responseButtons) {
            const text = await button.textContent();
            const statusMatch = text?.match(/(\d{3})\s*(.+)?/);
            
            if (statusMatch) {
                const code = statusMatch[1];
                const description = statusMatch[2]?.trim() || '';
                
                if (!responses.find(r => r.code === code)) {
                    responses.push({ code, description });
                    console.log(`     Documented: ${code} - ${description}`);
                }
            }
        }
        
        // Also look for text patterns in the page
        const pageContent = await page.content();
        const statusPatterns = [
            /(\d{3})\s+(Success|Created)/gi,
            /(\d{3})\s+(Bad Request|Invalid)/gi,
            /(\d{3})\s+(Unauthorized|Not Authenticated)/gi,
            /(\d{3})\s+(Forbidden)/gi,
            /(\d{3})\s+(Not Found|Resource Not Found)/gi,
            /(\d{3})\s+(Conflict)/gi,
            /(\d{3})\s+(Unprocessable Entity)/gi,
            /(\d{3})\s+(Internal Server Error|Server Error)/gi,
            /(\d{3})\s+(Not Implemented)/gi,
            /(\d{3})\s+(Bad Gateway)/gi,
            /(\d{3})\s+(Service Unavailable)/gi,
            /(\d{3})\s+(Gateway Timeout|Timeout)/gi
        ];
        
        statusPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(pageContent)) !== null) {
                const code = match[1];
                const description = match[2];
                
                if (!responses.find(r => r.code === code)) {
                    responses.push({ code, description });
                    console.log(`     Pattern match: ${code} - ${description}`);
                }
            }
        });
        
    } catch (error) {
        console.log(`   Warning: Error extracting documented responses: ${error.message}`);
    }
    
    return responses;
}

async function extractStatusCodeDropdowns(page) {
    const statusCodes = [];
    
    try {
        // Enhanced dropdown detection with better selectors
        const dropdownSelectors = [
            'button:has-text("200")',
            'button:has-text("400")', 
            'button:has-text("401")',
            'button:has-text("Success")',
            'button:has-text("Error")',
            '.status-button',
            '[data-testid*="status"]'
        ];
        
        for (const selector of dropdownSelectors) {
            try {
                const buttons = await page.locator(selector).all();
                
                for (const button of buttons) {
                    const text = await button.textContent();
                    if (!text || !text.includes('20') && !text.includes('40') && !text.includes('50')) continue;
                    
                    try {
                        await button.click();
                        await page.waitForTimeout(500);
                        
                        // Look for menu items
                        const menuItems = await page.locator('.bp5-popover-content .bp5-menu-item, .dropdown-menu .menu-item, [role="menu"] [role="menuitem"]').all();
                        
                        for (const item of menuItems) {
                            const itemText = await item.textContent();
                            const itemMatch = itemText?.match(/(\d{3})\s*(.+)?/);
                            
                            if (itemMatch) {
                                const code = itemMatch[1];
                                const description = itemMatch[2]?.trim() || '';
                                
                                if (!statusCodes.find(s => s.code === code)) {
                                    statusCodes.push({ code, description });
                                    console.log(`     Dropdown: ${code} - ${description}`);
                                }
                            }
                        }
                        
                        // Close dropdown
                        await page.click('body');
                        await page.waitForTimeout(300);
                        
                    } catch (e) {
                        // Skip this button if interaction fails
                    }
                }
                
                // If we found codes from this selector, we can break
                if (statusCodes.length > 0) break;
                
            } catch (e) {
                // Try next selector
            }
        }
        
    } catch (error) {
        console.log(`   Warning: Error extracting dropdown codes: ${error.message}`);
    }
    
    return statusCodes;
}

async function extractStatusCodesOriginal(page) {
    const statusCodes = [];
    
    try {
        const statusDropdowns = await page.locator('button').filter({ hasText: /\d{3}\s+(Success|Error|Client Error|Server Error)/ }).all();
        
        for (const dropdown of statusDropdowns) {
            try {
                await dropdown.click();
                await page.waitForTimeout(300);
                
                const popoverContent = page.locator('.bp5-popover-content .bp5-menu');
                if (await popoverContent.isVisible()) {
                    const menuItems = await popoverContent.locator('.bp5-menu-item').all();
                    
                    for (const item of menuItems) {
                        const text = await item.textContent();
                        if (text) {
                            const match = text.trim().match(/^(\d{3})/);
                            if (match) {
                                const statusCode = match[1];
                                if (!statusCodes.includes(statusCode)) {
                                    statusCodes.push(statusCode);
                                }
                            }
                        }
                    }
                    
                    await page.click('body');
                    await page.waitForTimeout(200);
                }
            } catch (e) {
                console.log(`Warning: Could not process status dropdown: ${e.message}`);
            }
        }
    } catch (error) {
        console.log(`Warning: Error extracting status codes: ${error.message}`);
    }
    
    return statusCodes.sort((a, b) => parseInt(a) - parseInt(b));
}

async function extractRequestDetails(page) {
    const jsonTabs = [
        { name: 'URL & QUERY', selector: '.api-explorer__try-it__json-buttons button:has-text("URL & QUERY")' },
        { name: 'HEADERS', selector: '.api-explorer__try-it__json-buttons button:has-text("HEADERS")' },
        { name: 'BODY', selector: '.api-explorer__try-it__json-buttons button:has-text("BODY")' }
    ];

    const extractedContent = {};
    
    for (const tab of jsonTabs) {
        try {
            const tabButton = page.locator(tab.selector);
            if (await tabButton.isVisible()) {
                await tabButton.click();
                await page.waitForTimeout(800); // Reduced wait time
                
                let content = '';
                
                if (tab.name === 'URL & QUERY') {
                    const urlContentSelectors = [
                        '.api-explorer__try-it__request .prism-code:not(.hidden) pre code',
                        '.api-explorer__try-it__request pre:visible code'
                    ];
                    
                    for (const selector of urlContentSelectors) {
                        try {
                            const elements = await page.locator(selector).all();
                            for (const element of elements) {
                                const text = await element.textContent();
                                if (text && text.includes('https://')) {
                                    const urlMatch = text.match(/https:\/\/[^\s"]+/);
                                    if (urlMatch) {
                                        content = urlMatch[0];
                                        break;
                                    }
                                }
                            }
                            if (content) break;
                        } catch (e) {
                            // Try next selector
                        }
                    }
                } else {
                    const codeBlocks = await page.locator('.api-explorer__try-it__request .prism-code:not(.hidden) pre.language-json code').allTextContents();
                    if (codeBlocks.length > 0) {
                        content = codeBlocks[0].trim();
                    }
                }
                
                if (content) {
                    extractedContent[tab.name.toLowerCase().replace(' & ', '_').replace(' ', '_')] = content;
                }
            }
        } catch (error) {
            console.log(`Warning: Error extracting ${tab.name}: ${error.message}`);
        }
    }
    
    return {
        url: extractedContent.url_query,
        headers: extractedContent.headers ? JSON.parse(extractedContent.headers) : {},
        body: extractedContent.body ? JSON.parse(extractedContent.body) : {}
    };
}

/**
 * Extract tokenized credentials from the API documentation page
 */
async function extractCredentialsFromPage(page) {
    const credentials = {};
    
    try {
        // Extract access token from headers tab
        const headersTab = page.locator('.api-explorer__try-it__json-buttons button:has-text("HEADERS")');
        if (await headersTab.isVisible()) {
            await headersTab.click();
            await page.waitForTimeout(500);
            
            const headerContent = await page.locator('.api-explorer__try-it__request .prism-code:not(.hidden) pre.language-json code').first().textContent();
            if (headerContent) {
                try {
                    const headers = JSON.parse(headerContent);
                    
                    // Extract various credential fields from headers
                    if (headers.authorization) {
                        credentials.pageAccessToken = headers.authorization;
                    }
                    if (headers['x-gp-version']) {
                        credentials.pageApiVersion = headers['x-gp-version'];
                    }
                    if (headers['content-type']) {
                        credentials.pageContentType = headers['content-type'];
                    }
                    if (headers.accept) {
                        credentials.pageAccept = headers.accept;
                    }
                } catch (e) {
                    console.log('Warning: Could not parse headers JSON for credentials');
                }
            }
        }
        
        // Extract API version from URL
        const urlTab = page.locator('.api-explorer__try-it__json-buttons button:has-text("URL & QUERY")');
        if (await urlTab.isVisible()) {
            await urlTab.click();
            await page.waitForTimeout(500);
            
            const urlContent = await page.locator('.api-explorer__try-it__request .prism-code:not(.hidden) pre code').first().textContent();
            if (urlContent) {
                // Extract base URL from the content
                const baseUrlMatch = urlContent.match(/(https:\/\/[^\/]+)/);
                if (baseUrlMatch) {
                    credentials.pageBaseUrl = baseUrlMatch[1];
                }
                
                // Look for API version in headers within the cURL command
                const versionMatch = urlContent.match(/-H\s+["']X-GP-Version:\s*([^"']+)["']/i);
                if (versionMatch) {
                    credentials.pageApiVersionFromCurl = versionMatch[1];
                }
                
                // Look for authorization token in cURL command
                const authMatch = urlContent.match(/-H\s+["']Authorization:\s*([^"']+)["']/i);
                if (authMatch) {
                    credentials.pageAccessTokenFromCurl = authMatch[1];
                }
            }
        }
        
        // Extract additional credentials from page content
        const pageContent = await page.content();
        
        // Look for example tokens in the HTML
        const tokenPatterns = [
            /Bearer\s+([A-Za-z0-9_-]+)/g,
            /"access_token":\s*"([^"]+)"/g,
            /"token":\s*"([^"]+)"/g
        ];
        
        tokenPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(pageContent)) !== null) {
                if (match[1] && match[1].length > 10) { // Only capture substantial tokens
                    if (!credentials.pageTokensFound) {
                        credentials.pageTokensFound = [];
                    }
                    if (!credentials.pageTokensFound.includes(match[1])) {
                        credentials.pageTokensFound.push(match[1]);
                    }
                }
            }
        });
        
        // Limit to first 3 tokens to avoid too much data
        if (credentials.pageTokensFound && credentials.pageTokensFound.length > 3) {
            credentials.pageTokensFound = credentials.pageTokensFound.slice(0, 3);
        }
        
    } catch (error) {
        console.log(`Warning: Error extracting credentials from page: ${error.message}`);
    }
    
    return credentials;
}

async function makeAPICall(apiRequest, expectedStatusCode) {
    try {
        const response = await fetch(apiRequest.url, {
            method: apiRequest.method,
            headers: apiRequest.headers,
            body: apiRequest.body
        });
        
        const responseBody = await response.text();
        let parsedBody;
        
        try {
            parsedBody = JSON.parse(responseBody);
        } catch (e) {
            parsedBody = responseBody;
        }
        
        return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: parsedBody,
            expected: expectedStatusCode,
            matched: response.status.toString() === expectedStatusCode
        };
        
    } catch (error) {
        return {
            status: null,
            statusText: 'Network Error',
            headers: {},
            body: error.message,
            expected: expectedStatusCode,
            matched: false,
            error: true
        };
    }
}

/**
 * Update dashboard with latest results and automatically open it
 */
async function updateDashboardAndOpen() {
    try {
        console.log('\n🔄 Updating dashboard with latest results...');
        
        // Import exec for running shell commands
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Update the dashboard with latest results
        await execAsync('node update-dashboard.js');
        console.log('✅ Dashboard updated successfully!');
        
        // Auto-open the results dashboard
        const dashboardPath = new URL('results-dashboard-autoload.html', import.meta.url).pathname;
        
        // Platform-specific open command
        let openCommand;
        if (process.platform === 'darwin') {
            openCommand = `open "${dashboardPath}"`;
        } else if (process.platform === 'win32') {
            openCommand = `start "${dashboardPath}"`;
        } else {
            openCommand = `xdg-open "${dashboardPath}"`;
        }
        
        await execAsync(openCommand);
        console.log('🌐 Results dashboard opened in your default browser!');
        
    } catch (error) {
        console.log(`⚠️ Could not auto-open dashboard: ${error.message}`);
        console.log('💡 You can manually open: results-dashboard-autoload.html');
    }
}

// Run the multi-endpoint response generator
generateAPIResponse().catch(console.error);
