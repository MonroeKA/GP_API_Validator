#!/usr/bin/env node
// Backend server for the API scraper frontend

import express from 'express';
import { firefox } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Serve the frontend
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'frontend.html'));
});

// Main API endpoint for extraction and testing
app.post('/api/extract', async (req, res) => {
    try {
        const { url, runLiveTest, saveResults } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log(`📄 Processing URL: ${url}`);
        
        // Extract data from the URL
        const extractedData = await extractFromUrl(url);
        
        let testResults = null;
        
        // Run live test if requested
        if (runLiveTest && extractedData.method && extractedData.url) {
            console.log('🚀 Running live API tests for each code snippet...');
            testResults = await testAllSnippets(extractedData);
        }
        
        // Save results if requested
        let resultsFile = null;
        if (saveResults) {
            const timestamp = Date.now();
            resultsFile = `extraction-results-${timestamp}.json`;
            await fs.writeFile(resultsFile, JSON.stringify({
                testTimestamp: new Date().toISOString(),
                sourceUrl: url,
                extractedData: extractedData,
                testResults: testResults,
                success: !!(extractedData.method && extractedData.url)
            }, null, 2));
            
            console.log(`💾 Results saved to: ${resultsFile}`);
        } else {
            console.log(`ℹ️  Saving disabled: results not saved to file`);
        }
        
        res.json({
            success: true,
            extractedData: extractedData,
            testResults: testResults,
            savedFile: resultsFile,
            timestamp: new Date().toISOString(),
            message: 'Successfully processed URL'
        });
        
    } catch (error) {
        console.error('❌ Error processing request:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to process URL'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Generate fresh access token
async function generateFreshToken() {
    try {
        console.log('🔑 Generating fresh access token...');
        
        // Load credentials from .env
        const envPath = path.join(process.cwd(), '.env');
        const envData = await fs.readFile(envPath, 'utf8');
        
        const envVars = {};
        envData.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key.trim()] = value.trim().split('#')[0].trim();
                }
            }
        });
        
        // Use OAuth 2.0 to get access token from Global Payments
        const tokenEndpoint = 'https://apis.sandbox.globalpay.com/ucp/accesstoken';
        
        // Generate proper secret as per Global Payments documentation
        // Secret = SHA512(nonce + appKey)
        const nonce = Date.now().toString() + Math.random().toString(36).substring(2);
        const secret = crypto.createHash('sha512').update(nonce + envVars.GP_API_APP_KEY).digest('hex');
        
        console.log('   📤 Requesting token from Global Payments...');
        
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-GP-Version': '2021-03-22'
            },
            body: JSON.stringify({
                app_id: envVars.GP_API_APP_ID,
                nonce: nonce,
                secret: secret,
                grant_type: 'client_credentials'
            })
        });
        
        const responseText = await response.text();
        
        if (!response.ok) {
            console.error(`   ❌ Token request failed: ${response.status}`);
            console.error(`   Response: ${responseText}`);
            throw new Error(`Token request failed: ${response.status} - ${responseText}`);
        }
        
        const tokenResponse = JSON.parse(responseText);
        
        // Create token data with scope
        const tokenData = {
            token: tokenResponse.token,
            type: tokenResponse.type || 'Bearer',
            app_id: envVars.GP_API_APP_ID,
            seconds_to_expire: tokenResponse.seconds_to_expire,
            email: tokenResponse.email,
            scope: tokenResponse.scope
        };
        
        // Save to file
        const tokenFile = path.join(process.cwd(), 'gp-access-token.json');
        await fs.writeFile(tokenFile, JSON.stringify(tokenData, null, 2));
        
        console.log(`✅ Fresh token generated (expires in ${tokenResponse.seconds_to_expire}s)`);
        return tokenData;
        
    } catch (error) {
        console.error('❌ Error generating token:', error.message);
        throw error;
    }
}

async function extractFromUrl(testUrl) {
    const browser = await firefox.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        timeout: 120000 // 120 second browser timeout
    });
    
    const page = await browser.newPage();
    
    // Set global timeouts to prevent hanging
    page.setDefaultTimeout(30000); // 30 seconds for individual operations
    page.setDefaultNavigationTimeout(60000); // 60 seconds for page navigation
    
    let extractedData = {};
    let extractionLog = [];
    
    // Helper function to log to both console and extraction log
    const logMessage = (message) => {
        console.log(message);
        extractionLog.push(message);
    };
    
    try {
        // Try multiple loading strategies
        console.log('   Attempting to load page...');
        
        try {
            // First attempt: wait for networkidle
            await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 15000 });
        } catch (networkIdleError) {
            console.log('   NetworkIdle timeout, trying domcontentloaded...');
            try {
                // Second attempt: just wait for DOM
                await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            } catch (domError) {
                console.log('   DOM timeout, trying basic load...');
                // Third attempt: basic load
                await page.goto(testUrl, { waitUntil: 'load', timeout: 8000 });
            }
        }
        
        console.log('   Page loaded successfully');
        extractedData = await extractFromEndpoint(page);
        
    } catch (error) {
        console.error(`Extraction error: ${error.message}`);
        
        // If page failed to load, try to extract whatever we can
        if (error.name === 'TimeoutError') {
            console.log('   Attempting extraction from partially loaded page...');
            try {
                extractedData = await extractFromEndpoint(page);
                if (extractedData.method || extractedData.url) {
                    console.log('   Partial extraction successful');
                } else {
                    throw new Error('Page failed to load and no data could be extracted');
                }
            } catch (partialError) {
                throw new Error(`Page load timeout (30s exceeded) and partial extraction failed: ${partialError.message}`);
            }
        } else {
            throw error;
        }
    } finally {
        await browser.close();
    }
    
    // Include extraction log in the returned data
    extractedData.extractionLog = extractionLog.join('\n');
    
    return extractedData;
}

async function extractFromEndpoint(page) {
    const requestDetails = {
        method: null,
        url: null,
        headers: {},
        body: null,
        responseExamples: {},
        documentedStatusCodes: [],
        documentedStatusCodeDescriptions: {},
        codeSnippets: {},
        examples: [],
        extractedDocumentation: {}
    };
    
    let availableLanguages = [];
    
    try {
        // Wait for page to load
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
        } catch (loadError) {
            console.log('   ⚠️ Load state timeout, continuing anyway...');
        }
        
        await page.waitForTimeout(2000);
        
        // Dismiss cookie consent banner if present (blocks clicks)
        try {
            const cookieBanner = await page.locator('#onetrust-consent-sdk').first();
            const isVisible = await cookieBanner.isVisible().catch(() => false);
            if (isVisible) {
                // Try to find and click accept button
                const acceptButton = await page.locator('button#onetrust-accept-btn-handler').first();
                const acceptVisible = await acceptButton.isVisible().catch(() => false);
                if (acceptVisible) {
                    await acceptButton.click();
                    console.log('   ✓ Dismissed cookie consent banner');
                    await page.waitForTimeout(1000);
                }
            }
        } catch (e) {
            // Cookie banner not present or already dismissed
        }
        
        console.log('   🔄 Starting comprehensive code extraction...');
        
        // ===== TASK 2: HANDLE ALL DROPDOWNS & LANGUAGES =====
        console.log('\n   📋 TASK 2: Detecting language options and examples...');
        
        // Step 1: Find language buttons using the correct selector
        // Language button: class="mx-0 mt-1 request-switcher border border-solid border-[#ffffff4d] rounded-[6px] w-full flex justify-between items-center py-1.5 px-3"
        const allButtons = await page.locator('button').all();
        let languageDropdown = null;
        let languageDropdownText = '';
        
        console.log(`      🔍 Scanning ${allButtons.length} buttons for language dropdown...`);
        
        for (const btn of allButtons) {
            try {
                const btnText = await btn.textContent();
                const hasRequestSwitcherClass = await btn.evaluate((el) => el.classList.contains('request-switcher'));
                
                // Match language buttons: have "request-switcher" class AND text is a language name
                if (hasRequestSwitcherClass && btnText && btnText.trim().match(/^(JSON|CURL|cURL|Python|JavaScript|Java|PHP|Ruby|Go|Node)$/i)) {
                    languageDropdown = btn;
                    languageDropdownText = btnText.trim();
                    console.log(`      ✓ Found language dropdown: "${languageDropdownText}"`);
                    break;
                }
            } catch (e) {
                // Continue
            }
        }
        
        // Get list of available languages
        if (languageDropdown) {
            try {
                await languageDropdown.click();
                await page.waitForTimeout(800);
                
                const langOptions = await page.locator('a[role="menuitem"]').allTextContents();
                availableLanguages = langOptions
                    .map(text => text.trim().toLowerCase())
                    .filter(text => text && text.length > 0 && text.length < 20);
                
                console.log(`      ✓ Available languages: ${availableLanguages.join(', ')}`);
                
                // Close dropdown
                await languageDropdown.click();
                await page.waitForTimeout(500);
            } catch (e) {
                console.log(`      ⚠️ Could not read language options: ${e.message}`);
            }
        }
        
        // Step 2: Find example variations
        console.log(`\n   📋 Detecting example variations...`);
        let exampleDropdown = null;
        let exampleNames = [];
        
        console.log(`      🔍 Scanning ${allButtons.length} buttons for example dropdown...`);
        
        for (const btn of allButtons) {
            try {
                const btnText = await btn.textContent();
                const hasMenu = await btn.getAttribute('aria-haspopup');
                const classes = await btn.getAttribute('class');
                
                // Debug: log buttons with aria-haspopup
                if (hasMenu === 'menu') {
                    console.log(`      🔍 Button with menu: "${btnText?.trim()}" | Classes: ${classes?.substring(0, 80)}...`);
                }
                
                // Match the specific example dropdown button by its characteristics:
                // - Has aria-haspopup="menu"
                // - Has border-n-grey-76 class (distinguishes from language/version dropdowns)
                // - Is bp5-minimal with rounded styling
                // - Does NOT contain "Switch To" or "Viewing" (those are API version switchers)
                const isExampleDropdown = hasMenu === 'menu' && 
                                         classes?.includes('border-n-grey-76') &&
                                         btnText && 
                                         !btnText.includes('Switch To') &&
                                         !btnText.includes('Viewing');
                
                if (isExampleDropdown) {
                    exampleDropdown = btn;
                    console.log(`      ✓ Found example dropdown: "${btnText?.trim()}"`);
                    
                    // Click to get examples
                    await btn.click();
                    await page.waitForTimeout(1000);
                    
                    // Example menu items are in <ul class="api-explorer__example-list bp5-menu">
                    // Each item is an <a role="menuitem"> with text in a <div>
                    const exampleMenu = await page.locator('ul.api-explorer__example-list').first();
                    const exampleItems = await exampleMenu.locator('a[role="menuitem"]').all();
                    
                    console.log(`      🔍 Found ${exampleItems.length} items in api-explorer__example-list`);
                    
                    for (const item of exampleItems) {
                        try {
                            const itemText = await item.textContent();
                            if (itemText && itemText.trim()) {
                                exampleNames.push(itemText.trim());
                            }
                        } catch (e) {
                            // Skip
                        }
                    }
                    
                    console.log(`      ✓ Found ${exampleNames.length} examples: ${exampleNames.slice(0, 5).join(', ')}${exampleNames.length > 5 ? '...' : ''}`);
                    
                    // Close dropdown by clicking button again
                    await btn.click();
                    await page.waitForTimeout(500);
                    break;
                }
            } catch (e) {
                // Continue
            }
        }
        
        // Step 3: Find tab structure
        console.log(`\n   📋 Detecting tab structure...`);
        
        // Tabs are simple buttons with text: "URL & QUERY", "HEADERS", "BODY"
        // They appear at the top of the request/response section
        let tabNames = [];
        
        const allTabButtons = await page.locator('button').all();
        
        for (const tab of allTabButtons) {
            try {
                const tabText = await tab.textContent();
                if (tabText && tabText.trim()) {
                    const cleanText = tabText.trim();
                    // Look for exact tab names
                    if (cleanText === 'URL & QUERY' || cleanText === 'HEADERS' || cleanText === 'BODY') {
                        tabNames.push({ element: tab, name: cleanText });
                        console.log(`      ✓ Found tab: "${cleanText}"`);
                    }
                }
            } catch (e) {
                // Skip
            }
        }
        
        if (tabNames.length > 0) {
            console.log(`      ✓ Found ${tabNames.length} tabs: ${tabNames.map(t => t.name).join(', ')}`);
        } else {
            console.log(`      ⚠️ No tabs detected - checking for alternative tab structure...`);
            
            // Fallback: look for any BP5 buttons that might be tabs (excluding status code buttons)
            for (const tab of allTabButtons) {
                try {
                    const tabText = await tab.textContent();
                    const hasStatusCode = tabText?.match(/^\d{3}\s+/);
                    if (tabText && tabText.trim() && !hasStatusCode && !tabText.includes('Example')) {
                        tabNames.push({ element: tab, name: tabText.trim() });
                    }
                } catch (e) {
                    // Skip
                }
            }
        }
        
        // Step 4: Extract code for each language/example/tab combination
        console.log(`\n   📋 Extracting code snippets for each variation...`);
        let snippetCount = 0;
        
        // Handle case with no examples (single example)
        const examplesArray = exampleNames.length > 0 ? exampleNames : ['default'];
        
        console.log(`      ℹ️  Processing ${examplesArray.length} example(s)...`);
        
        for (let exampleIndex = 0; exampleIndex < examplesArray.length; exampleIndex++) {
            const exampleName = examplesArray[exampleIndex];
            
            if (exampleName !== 'default') {
                console.log(`\n   📂 Example ${exampleIndex + 1}/${examplesArray.length}: "${exampleName}"`);
                
                try {
                    // Click example dropdown and select this example
                    if (exampleDropdown) {
                        console.log(`      🔄 Switching to example: "${exampleName}"...`);
                        
                        // Dismiss cookie banner again if it reappeared
                        try {
                            const cookieButton = await page.locator('button#onetrust-accept-btn-handler').first();
                            const isVisible = await cookieButton.isVisible({ timeout: 500 }).catch(() => false);
                            if (isVisible) {
                                await cookieButton.click();
                                await page.waitForTimeout(500);
                                console.log(`      ✓ Dismissed cookie banner`);
                            }
                        } catch (e) {
                            // No cookie banner
                        }
                        
                        await exampleDropdown.click();
                        await page.waitForTimeout(1000);
                        
                        // Find the example in the api-explorer__example-list menu
                        const exampleMenu = await page.locator('ul.api-explorer__example-list').first();
                        const exampleItems = await exampleMenu.locator('a[role="menuitem"]').all();
                        
                        let foundExample = false;
                        for (const item of exampleItems) {
                            const itemText = await item.textContent();
                            if (itemText?.trim() === exampleName) {
                                // Force click to bypass any overlays
                                await item.click({ force: true });
                                await page.waitForTimeout(2000); // Wait longer for example to fully load
                                foundExample = true;
                                console.log(`      ✓ Switched to example: "${exampleName}"`);
                                break;
                            }
                        }
                        
                        if (!foundExample) {
                            console.log(`      ⚠️  Could not find example "${exampleName}" in dropdown, skipping`);
                            continue;
                        }
                    }
                } catch (e) {
                    console.log(`      ⚠️ Error selecting example "${exampleName}": ${e.message}`);
                    continue;
                }
            } else {
                console.log(`\n   📂 Using default example (no switching needed)`);
            }
            
            // IMPORTANT: Extract tabs for EACH language separately
            // Must process all tabs for one language BEFORE switching to the next language
            for (const lang of availableLanguages) {
                try {
                    console.log(`      📝 Extracting for language: ${lang}`);
                    
                    // Log current language shown in dropdown
                    const currentLangDisplay = await languageDropdown?.evaluate(el => el.textContent?.trim());
                    console.log(`         ℹ️  Current dropdown shows: "${currentLangDisplay}", target language: "${lang}"`);
                    
                    // For languages other than the default (JSON), switch to it first
                    if (lang !== availableLanguages[0] && languageDropdown) {
                        try {
                            console.log(`         🔄 Switching to ${lang} language...`);
                            await languageDropdown.click();
                            await page.waitForTimeout(1000);
                            
                            const langOptions = await page.locator('a[role="menuitem"]').all();
                            let found = false;
                            for (const option of langOptions) {
                                const optText = await option.textContent();
                                // Case-insensitive match (handles "cURL" vs "curl", "JSON" vs "json", etc.)
                                if (optText?.trim().toLowerCase() === lang.toLowerCase()) {
                                    try {
                                        await option.click({ force: true });
                                        
                                        // Wait for the UI to update (increased from 1.2s to 2s based on successful test)
                                        await page.waitForTimeout(2000);
                                        
                                        found = true;
                                        console.log(`         ✓ Successfully switched to ${lang}`);
                                        break;
                                    } catch (clickErr) {
                                        console.log(`         ⚠️ Click failed, trying keyboard...`);
                                        try {
                                            await option.focus();
                                            await page.keyboard.press('Enter');
                                            await page.waitForTimeout(1200);
                                            found = true;
                                            console.log(`         ✓ Successfully switched to ${lang} via keyboard`);
                                            break;
                                        } catch (e) {
                                            // Continue to next
                                        }
                                    }
                                }
                            }
                            
                            if (!found) {
                                console.log(`      ⚠️ Could not switch to ${lang} language, skipping`);
                                continue;
                            }
                        } catch (switchErr) {
                            console.log(`      ⚠️ Error switching to ${lang}: ${switchErr.message}`);
                            continue;
                        }
                    } else {
                        console.log(`         ℹ️  Using default ${lang} (no switch needed)`);
                    }
                    
                    // CRITICAL: Different languages have different structures
                    // JSON: Has multi-tab interface (URL & QUERY, HEADERS, BODY tabs) in .api-explorer__try-it__json container
                    // CURL: Single code block in .api-explorer__try-it__curl container - NO TABS
                    // The tab buttons you see are part of JSON's structure and should NOT be used for CURL
                    
                    let tabsForThisLanguage = [];
                    
                    // Check if this language actually uses tabs by checking the active container
                    if (lang === 'json') {
                        // JSON uses tabs - find them within the JSON container
                        const langTabButtons = await page.locator('button').all();
                        
                        for (const tab of langTabButtons) {
                            try {
                                const tabText = await tab.textContent();
                                if (tabText && tabText.trim()) {
                                    const cleanText = tabText.trim();
                                    if (cleanText === 'URL & QUERY' || cleanText === 'HEADERS' || cleanText === 'BODY') {
                                        tabsForThisLanguage.push({ element: tab, name: cleanText });
                                    }
                                }
                            } catch (e) {
                                // Skip
                            }
                        }
                        
                        // Set container for JSON tabs
                        for (const tab of tabsForThisLanguage) {
                            tab.containerClass = '.api-explorer__try-it__json';
                            tab.isSingleBlock = false;
                        }
                    } else {
                        // For all other languages (CURL, etc), treat as single block - NO TABS
                        console.log(`         ℹ️  ${lang} is a single-block language (no tabs)`);
                        
                        tabsForThisLanguage = [{ 
                            element: null, 
                            name: lang.toUpperCase(), 
                            containerClass: null,
                            isSingleBlock: true 
                        }];
                    }
                    
                    // NOW extract all tabs for THIS language
                    // All tab extraction happens while the correct language is active
                    const tabsToExtract = tabsForThisLanguage;
                    
                    console.log(`         ℹ️  Current language: ${lang}, Ready to extract ${tabsToExtract.length} item(s)`);
                    
                    if (tabsToExtract.length > 0) {
                        // Extract from all available tabs - must click each tab to render client-side content
                        for (const tabInfo of tabsToExtract) {
                            try {
                                // If element exists, click it; if null, it's a single code block language (no tab switching needed)
                                if (tabInfo.element) {
                                    console.log(`         📑 Clicking tab: "${tabInfo.name}" for language ${lang}`);
                                    await tabInfo.element.click();
                                    await page.waitForTimeout(1500); // Wait longer for content to render
                                } else {
                                    console.log(`         📑 No tabs for ${lang} - extracting single code block`);
                                    await page.waitForTimeout(1000);
                                }
                                
                                // DEBUG: Log what code blocks we find before extracting
                                const blockCount = await page.evaluate(() => {
                                    const codes = document.querySelectorAll('code, pre');
                                    return codes.length;
                                });
                                console.log(`         ℹ️  Found ${blockCount} code blocks on page`);
                                
                                // Extract code using the exact HTML structure from the documentation
                                const codeText = await page.evaluate(({ languageCode, tabName, isSingleBlock }) => {
                                    if (isSingleBlock) {
                                        // CURL: Extract from .api-explorer__try-it__curl.active
                                        const curlContainer = document.querySelector('.api-explorer__try-it__curl');
                                        if (!curlContainer) {
                                            console.log('[DEBUG] CURL container not found');
                                            return null;
                                        }
                                        
                                        const codeElement = curlContainer.querySelector('code');
                                        if (!codeElement) {
                                            console.log('[DEBUG] CURL code element not found');
                                            return null;
                                        }
                                        
                                        const text = codeElement.textContent.trim();
                                        console.log(`[DEBUG] Extracted CURL: ${text.substring(0, 50)}...`);
                                        return text;
                                        
                                    } else {
                                        // JSON: Extract from .api-explorer__try-it__json .api-explorer__try-it__json__[url|headers|body]
                                        const jsonContainer = document.querySelector('.api-explorer__try-it__json');
                                        if (!jsonContainer) {
                                            console.log('[DEBUG] JSON container not found');
                                            return null;
                                        }
                                        
                                        // Map tab names to their specific selectors
                                        const tabSelectors = {
                                            'URL & QUERY': '.api-explorer__try-it__json__url',
                                            'HEADERS': '.api-explorer__try-it__json__headers',
                                            'BODY': '.api-explorer__try-it__json__body'
                                        };
                                        
                                        const selector = tabSelectors[tabName];
                                        if (!selector) {
                                            console.log(`[DEBUG] Unknown tab: ${tabName}`);
                                            return null;
                                        }
                                        
                                        const tabContainer = jsonContainer.querySelector(selector);
                                        if (!tabContainer) {
                                            console.log(`[DEBUG] Tab container ${selector} not found`);
                                            return null;
                                        }
                                        
                                        const codeElement = tabContainer.querySelector('code');
                                        if (!codeElement) {
                                            console.log(`[DEBUG] Code element not found in ${selector}`);
                                            return null;
                                        }
                                        
                                        const text = codeElement.textContent.trim();
                                        console.log(`[DEBUG] Extracted ${tabName}: ${text.substring(0, 50)}...`);
                                        return text;
                                    }
                                }, { languageCode: lang, tabName: tabInfo.name, isSingleBlock: tabInfo.isSingleBlock });
                                
                                if (!codeText || codeText.length === 0) {
                                    console.log(`         ⊘ No code content found in ${tabInfo.name} tab for ${lang}`);
                                    continue;
                                }
                                
                                console.log(`         ✓ Extracted content from ${tabInfo.name} - ${codeText.substring(0, 40)}...`);
                                
                                // Create unique key for this language+tab combination
                                // For single-block languages like CURL, use just the language as the key (no subtabs)
                                let key, label;
                                
                                if (tabInfo.isSingleBlock) {
                                    // Single block - just use language name
                                    const exampleSuffix = exampleName !== 'default' ? `_${exampleName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
                                    key = `${lang}${exampleSuffix}`;
                                    label = lang.toUpperCase();
                                } else {
                                    // Multi-tab language - include tab name in key
                                    const tabNameCleaned = tabInfo.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                    const exampleSuffix = exampleName !== 'default' ? `_${exampleName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
                                    key = `${lang}_${tabNameCleaned}${exampleSuffix}`;
                                    label = tabInfo.name;
                                }
                                
                                // Only store if we have content and haven't already extracted this key
                                if (codeText && codeText.length > 0 && !requestDetails.codeSnippets[key]) {
                                    requestDetails.codeSnippets[key] = codeText;
                                    // Store the tab name as label
                                    if (!requestDetails.codeSnippets._labels) {
                                        requestDetails.codeSnippets._labels = {};
                                    }
                                    requestDetails.codeSnippets._labels[key] = label;
                                    snippetCount++;
                                    console.log(`         ✓ Stored ${key} with label "${label}"`);
                                }
                            } catch (tabError) {
                                console.log(`      ⚠️ Error processing tab "${tabInfo.name}": ${tabError.message}`);
                            }
                        }
                    } else {
                        console.log(`      ⚠️ No tabs found for extraction`);
                    }
                } catch (langError) {
                    console.log(`      ⚠️ Error processing language "${lang}": ${langError.message}`);
                }
            }
        }
        
        // ===== TASK 3: EXTRACT RESPONSE CODE DEFINITIONS =====
        console.log(`\n   📋 TASK 3: Extracting response code definitions...`);
        
        try {
            // Find response code dropdown button using Blueprint button selector
            // Response code button: class="bp5-button bp5-minimal" with text containing status code
            const foundStatusCodes = new Map();
            
            // Strategy 1: Look for Blueprint buttons with status codes (200 Success, etc)
            const responseCodeButtons = await page.locator('button.bp5-button.bp5-minimal').all();
            
            for (const btn of responseCodeButtons) {
                try {
                    const btnText = await btn.textContent();
                    const match = btnText?.match(/(\d{3})\s+(.+)/);
                    if (match) {
                        const code = match[1];
                        const desc = match[2].trim();
                        foundStatusCodes.set(code, `${code} ${desc}`);
                        console.log(`      ✓ Found response code button: ${code} ${desc}`);
                        
                        // Click to open dropdown and get all options
                        try {
                            await btn.click();
                            await page.waitForTimeout(700);
                            
                            // Extract all menu items from dropdown
                            const menuItems = await page.locator('a[role="menuitem"]').allTextContents();
                            for (const item of menuItems) {
                                const itemMatch = item?.match(/(\d{3})\s+(.+)/);
                                if (itemMatch) {
                                    const itemCode = itemMatch[1];
                                    const itemDesc = itemMatch[2].trim();
                                    foundStatusCodes.set(itemCode, `${itemCode} ${itemDesc}`);
                                }
                            }
                            
                            // Close dropdown
                            await btn.click();
                            await page.waitForTimeout(500);
                        } catch (dropdownError) {
                            // Continue if can't open dropdown
                        }
                        
                        break; // Found the main response code button, can stop
                    }
                } catch (e) {
                    // Continue to next button
                }
            }
            
            // Strategy 2: If no buttons found, try looking in menu items directly
            if (foundStatusCodes.size === 0) {
                try {
                    const statusCodeSelectors = [
                        'a[role="menuitem"] div.bp5-text-overflow-ellipsis',
                        'a[role="menuitem"]',
                        '[class*="status"][class*="code"]'
                    ];
                    
                    for (const selector of statusCodeSelectors) {
                        try {
                            const codeElements = await page.locator(selector).all();
                            for (const elem of codeElements) {
                                try {
                                    const text = await elem.textContent();
                                    const match = text?.match(/^(\d{3})\s+(.+)$/);
                                    if (match) {
                                        const code = match[1];
                                        const desc = match[2];
                                        foundStatusCodes.set(code, `${code} ${desc}`);
                                        console.log(`      ✓ Found response code: ${code} ${desc}`);
                                    }
                                } catch (e) {
                                    // Continue
                                }
                            }
                        } catch (selectorError) {
                            // Try next selector
                        }
                        
                        if (foundStatusCodes.size > 0) break;
                    }
                } catch (e) {
                    // Continue to fallback
                }
            }
            
            // Fallback: Parse from page text
            if (foundStatusCodes.size === 0) {
                const pageText = await page.evaluate(() => document.body.innerText);
                const statusMatches = pageText.match(/(\d{3})\s+(Success|OK|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Server Error|Service Unavailable|Bad Gateway|Timeout|Not Implemented|Internal Server Error|Unprocessable Entity|Created|Accepted|Conflict|Gone|Unprocessable Entity)/gi) || [];
                
                for (const match of statusMatches) {
                    const parts = match.trim().split(/\s+/);
                    const code = parts[0];
                    const desc = parts.slice(1).join(' ');
                    if (/^\d{3}$/.test(code)) {
                        foundStatusCodes.set(code, `${code} ${desc}`);
                    }
                }
            }
            
            if (foundStatusCodes.size > 0) {
                requestDetails.documentedStatusCodes = Array.from(foundStatusCodes.keys()).sort();
                requestDetails.documentedStatusCodeDescriptions = Object.fromEntries(foundStatusCodes);
                console.log(`      ✓ Found ${foundStatusCodes.size} response codes`);
            } else {
                console.log(`      ⚠️ No response codes found`);
            }
        } catch (statusError) {
            console.log(`      ⚠️ Error extracting response codes: ${statusError.message}`);
        }
        
        // ===== TASK 4: EXTRACT FULL ENDPOINT DOCUMENTATION =====
        console.log(`\n   📋 TASK 4: Extracting endpoint documentation...`);
        
        try {
            // Extract HTTP method
            const pageText = await page.evaluate(() => document.body.innerText);
            const methodMatch = pageText.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/i);
            if (methodMatch) {
                requestDetails.method = methodMatch[1].toUpperCase();
                console.log(`      ✓ HTTP Method: ${requestDetails.method}`);
            }
            
            // Extract URL from code or documentation
            const urlMatch = pageText.match(/https?:\/\/[^\s"'<>]+/);
            if (urlMatch) {
                requestDetails.url = urlMatch[0];
                console.log(`      ✓ Endpoint URL: ${requestDetails.url.substring(0, 60)}...`);
            }
            
            // Extract headers from first code snippet
            const headerPatterns = [
                /Authorization:\s*Bearer\s+[\w\.]+/i,
                /Content-Type:\s*application\/json/i,
                /X-GP-Version:\s*[\d-]+/i
            ];
            
            for (const pattern of headerPatterns) {
                const match = pageText.match(pattern);
                if (match) {
                    const [key, value] = match[0].split(':').map(s => s.trim());
                    requestDetails.headers[key] = value;
                }
            }
            
            if (Object.keys(requestDetails.headers).length > 0) {
                console.log(`      ✓ Found ${Object.keys(requestDetails.headers).length} header requirements`);
            }
            
            // Extract request/response examples from code snippets
            for (const [key, code] of Object.entries(requestDetails.codeSnippets)) {
                try {
                    if (code.startsWith('{') && code.endsWith('}')) {
                        const jsonData = JSON.parse(code);
                        
                        // Detect if this is a request or response
                        if (hasRequestSignature(jsonData)) {
                            requestDetails.body = jsonData;
                            console.log(`      ✓ Extracted request body structure`);
                        } else if (hasResponseSignature(jsonData)) {
                            requestDetails.responseExamples[key] = jsonData;
                        }
                    }
                } catch (parseError) {
                    // Not JSON, continue
                }
            }
            
        } catch (docError) {
            console.log(`      ⚠️ Error extracting documentation: ${docError.message}`);
        }
        
        console.log(`\n   ✅ Extraction complete!`);
        console.log(`      • Code snippets: ${Object.keys(requestDetails.codeSnippets).length}`);
        console.log(`      • Languages: ${availableLanguages.join(', ')}`);
        console.log(`      • Response codes: ${requestDetails.documentedStatusCodes.join(', ')}`);
        console.log(`      • HTTP Method: ${requestDetails.method || 'Unknown'}`);
            
    } catch (error) {
        console.log(`   ❌ Extraction error: ${error.message}`);
    }
    
    // Add available languages to request details
    requestDetails.availableLanguages = availableLanguages;
    
    return requestDetails;
}

function hasRequestSignature(obj) {
    const requestFields = ['amount', 'card', 'payment', 'account_id', 'currency', 'reference_id'];
    return requestFields.some(field => obj.hasOwnProperty(field));
}

function hasHeaderSignature(obj) {
    return Object.keys(obj).some(key => 
        key.toLowerCase().includes('authorization') || 
        key.toLowerCase().includes('content-type') ||
        key.toLowerCase().includes('x-gp')
    );
}

function hasResponseSignature(obj) {
    const responseFields = [
        // Success response fields
        'id', 'status', 'time_created', 'merchant_id', 'account_id', 'transaction_id', 'batch_id', 'token',
        'total_record_count', 'current_page_size', 'merchant_name', 'accounts', 'scope',
        // Error response fields
        'error', 'message', 'error_code', 'detailed_error_code', 'detailed_error_description',
        'response_code', 'response_message', 'gateway_response_code', 'gateway_response_message',
        // Common API response indicators
        'success', 'result', 'data', 'timestamp', 'request_id'
    ];
    return responseFields.some(field => obj.hasOwnProperty(field)) ||
           // Check for nested error objects
           (obj.error && typeof obj.error === 'object') ||
           // Check for response wrapper patterns
           (obj.response && typeof obj.response === 'object');
}

async function testAllSnippets(extractedData) {
    const documentedStatusCodes = extractedData.documentedStatusCodes || [];
    
    // Attempt to generate fresh token, but don't fail if we can't
    try {
        await generateFreshToken();
    } catch (error) {
        console.warn(`⚠️  Could not generate fresh token: ${error.message}`);
        console.log('   Using existing token if available...');
    }
    
    // Parse code snippets and group by example
    const exampleRequests = parseSnippetsByExample(extractedData.codeSnippets);
    
    // If no examples found, create a default example using the base extracted data
    if (Object.keys(exampleRequests).length === 0) {
        console.log(`   ℹ️  No named examples found, creating default example from extracted data`);
        exampleRequests['default'] = {
            url: extractedData.url,
            headers: extractedData.headers || {},
            body: extractedData.body
        };
    }
    
    console.log(`\n🧪 Testing ${Object.keys(exampleRequests).length} example(s) against API...`);
    console.log(`📋 Documented status codes: ${documentedStatusCodes.join(', ')}`);
    
    const results = {
        documentedStatusCodes: documentedStatusCodes,
        exampleTests: {}
    };
    
    // Test each example individually - including all status code scenarios
    for (const [exampleName, exampleData] of Object.entries(exampleRequests)) {
        console.log(`\n📂 Testing example: "${exampleName}"...`);
        
        // Build base request data for this example
        const baseRequestData = {
            method: extractedData.method || 'POST',
            url: exampleData.url || extractedData.url,
            headers: exampleData.headers || {},
            body: exampleData.body,
            documentedStatusCodes: documentedStatusCodes
        };
        
        console.log(`   🔗 URL: ${baseRequestData.url}`);
        console.log(`   📦 Body fields: ${baseRequestData.body ? Object.keys(baseRequestData.body).join(', ') : 'none'}`);
        
        // Test normal request (200) plus all documented status codes for this example
        const exampleTestResults = {
            exampleName: exampleName,
            url: baseRequestData.url,
            method: baseRequestData.method,
            statusCodeTests: {}
        };
        
        // Run status code tests for this specific example
        console.log(`\n   🎯 Testing status code scenarios for "${exampleName}"...`);
        exampleTestResults.statusCodeTests = await testStatusCodesForExample(baseRequestData, documentedStatusCodes);
        
        results.exampleTests[exampleName] = exampleTestResults;
    }
    
    return results;
}

function parseSnippetsByExample(codeSnippets) {
    const examples = {};
    
    // Group snippets by example name
    for (const [key, code] of Object.entries(codeSnippets)) {
        if (key === '_labels') continue;
        
        const parts = key.split('_');
        const lang = parts[0];
        
        // Extract example name using same logic as frontend
        // Key format: json_url___query_create_a_paylink, json_headers_create_a_paylink, curl_create_a_paylink
        let exampleName = 'default';
        
        if (lang === 'json') {
            // For JSON, we need to skip the tab name part
            // Tab names: url___query, headers, body
            if (key.includes('_url___query_')) {
                // Split on _url___query_ and take everything after
                exampleName = key.split('_url___query_')[1];
            } else if (key.includes('_headers_')) {
                // Split on _headers_ and take everything after
                exampleName = key.split('_headers_')[1];
            } else if (key.includes('_body_')) {
                // Split on _body_ and take everything after
                exampleName = key.split('_body_')[1];
            }
        } else {
            // For other languages (curl, etc), everything after language is the example name
            exampleName = parts.slice(1).join('_');
        }
        
        // Skip if we couldn't extract a valid example name
        if (!exampleName || exampleName === 'default') {
            console.log(`      ⚠️ Could not extract example name from key: ${key}`);
            continue;
        }
        
        if (!examples[exampleName]) {
            examples[exampleName] = {
                url: null,
                headers: null,
                body: null
            };
        }
        
        // Parse JSON snippets to extract data
        if (lang === 'json') {
            try {
                if (key.includes('url___query')) {
                    // Extract URL from URL & QUERY tab
                    const urlMatch = code.match(/https?:\/\/[^\s"'\n]+/);
                    if (urlMatch) {
                        examples[exampleName].url = urlMatch[0];
                    }
                } else if (key.includes('headers')) {
                    // Parse headers JSON
                    const parsed = JSON.parse(code);
                    examples[exampleName].headers = parsed;
                } else if (key.includes('body')) {
                    // Parse body JSON
                    const parsed = JSON.parse(code);
                    examples[exampleName].body = parsed;
                }
            } catch (parseError) {
                console.log(`      ⚠️ Could not parse ${key}: ${parseError.message}`);
            }
        }
    }
    
    console.log(`   📊 Parsed ${Object.keys(examples).length} example(s): ${Object.keys(examples).join(', ')}`);
    
    return examples;
}

async function testStatusCodesForExample(baseRequestData, documentedCodes) {
    const testResults = {};
    
    for (const code of documentedCodes) {
        console.log(`      🔬 Testing scenario for ${code}...`);
        
        try {
            let result;
            let requestData = { ...baseRequestData };
            
            switch (code) {
                case '200':
                    // Test 1: Valid request with proper auth
                    console.log(`         Scenario: Valid request with proper authentication`);
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '400':
                    // Test 2: Invalid parameters (bad data in request)
                    console.log(`         Scenario: Request with invalid parameters`);
                    requestData = { ...baseRequestData };
                    requestData.url = requestData.url + '?page_size=invalid&from_time_created=not_a_date';
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '401':
                    // Test 3: No auth or invalid token
                    console.log(`         Scenario: Request with invalid/missing authentication`);
                    requestData = { ...baseRequestData };
                    requestData.useInvalidToken = true;
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '403':
                    // Test 4: Insufficient permissions
                    console.log(`         Scenario: Request to restricted resource`);
                    requestData = { ...baseRequestData };
                    requestData.url = 'https://apis.sandbox.globalpay.com/ucp/merchants/MER_RESTRICTED_ACCESS_DENIED/accounts';
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '404':
                    // Test 5: Non-existent endpoint
                    console.log(`         Scenario: Request to non-existent endpoint`);
                    requestData = { ...baseRequestData };
                    requestData.url = requestData.url.replace(/\/[^\/]*$/, '/endpoint-does-not-exist-xyz');
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '500':
                case '501':
                case '502':
                    // Test server errors by making a valid request
                    console.log(`         Scenario: ${getScenarioName(code)}`);
                    result = await testLiveAPI(requestData);
                    break;
                    
                default:
                    continue;
            }
            
            // Record result
            testResults[code] = {
                scenario: getScenarioName(code),
                expectedCode: code,
                actualCode: result.statusCode,
                matched: String(result.statusCode) === String(code),
                statusText: result.statusText,
                responseTime: result.responseTime,
                responseBody: result.body,
                method: result.method,
                url: result.url
            };
            
            if (String(result.statusCode) === String(code)) {
                console.log(`         ✅ Successfully triggered ${code}`);
            } else {
                console.log(`         ⚠️  Got ${result.statusCode} instead of ${code}`);
            }
            
        } catch (error) {
            console.log(`         ❌ Error testing ${code}: ${error.message}`);
            testResults[code] = {
                scenario: getScenarioName(code),
                expectedCode: code,
                actualCode: null,
                matched: false,
                error: error.message,
                statusText: 'Error',
                responseTime: 0
            };
        }
    }
    
    return testResults;
}

function getScenarioName(code) {
    const scenarios = {
        '200': 'Valid request with proper authentication',
        '400': 'Bad Request - invalid parameters',
        '401': 'Unauthorized - invalid/missing authentication',
        '403': 'Forbidden - insufficient permissions',
        '404': 'Not Found - non-existent endpoint',
        '500': 'Internal server error',
        '501': 'Not implemented',
        '502': 'Bad gateway'
    };
    return scenarios[code] || `HTTP ${code}`;
}

async function testLiveAPI(requestData) {
    try {
        // Load credentials
        const envPath = path.join(process.cwd(), '.env');
        const envData = await fs.readFile(envPath, 'utf8');
        
        const envVars = {};
        envData.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key.trim()] = value.trim().split('#')[0].trim();
                }
            }
        });
        
        // Load token
        const tokenFile = path.join(process.cwd(), 'gp-access-token.json');
        const tokenData = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
        
        // Check if this is the access token endpoint (special case - doesn't use Bearer auth)
        const isAccessTokenEndpoint = requestData.url?.includes('/accesstoken');
        
        // Use invalid token if requested (to test 401)
        const token = requestData.useInvalidToken ? 'INVALID_TOKEN_12345' : tokenData.token;
        
        // Build headers - merge example headers with required auth headers
        // Filter out 'authorization' from example headers to prevent placeholder tokens from overriding real token
        const exampleHeaders = requestData.headers || {};
        const filteredExampleHeaders = Object.keys(exampleHeaders).reduce((acc, key) => {
            if (key.toLowerCase() !== 'authorization') {
                acc[key] = exampleHeaders[key];
            }
            return acc;
        }, {});
        
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-GP-Version': '2021-03-22',
            ...filteredExampleHeaders
        };
        
        // Only add Bearer token auth if NOT the access token endpoint
        if (!isAccessTokenEndpoint) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (envVars.GP_API_APP_ID) {
            headers['X-GP-Api-Key'] = envVars.GP_API_APP_ID;
        }
        
        let requestBody = requestData.body;
        if (requestData.method === 'POST' && requestBody) {
            // Special handling for access token endpoint - use real app credentials
            if (isAccessTokenEndpoint) {
                const nonce = Date.now().toString() + Math.random().toString(36).substring(2);
                const secret = crypto.createHash('sha512').update(nonce + envVars.GP_API_APP_KEY).digest('hex');
                
                requestBody = {
                    app_id: envVars.GP_API_APP_ID,
                    nonce: nonce,
                    secret: secret,
                    grant_type: 'client_credentials'
                };
                
                // Preserve any additional fields from the example (like permissions, seconds_to_expire)
                const exampleBody = requestData.body || {};
                if (exampleBody.permissions) {
                    requestBody.permissions = exampleBody.permissions;
                }
                if (exampleBody.seconds_to_expire) {
                    requestBody.seconds_to_expire = exampleBody.seconds_to_expire;
                }
            } else {
                // Normal endpoint handling - replace placeholder values with real ones
                // Replace placeholder merchant_id with real merchant_id from token
                if (requestBody.merchant_id && tokenData.scope?.merchant_id) {
                    requestBody = {
                        ...requestBody,
                        merchant_id: tokenData.scope.merchant_id
                    };
                }
                
                // Add or replace account_id with real account_id from token
                if (tokenData.scope?.accounts?.[0]?.id) {
                    requestBody = {
                        ...requestBody,
                        account_id: tokenData.scope.accounts[0].id
                    };
                }
                
                // Add or replace account_name with real account_name from token
                if (tokenData.scope?.accounts?.[0]?.name) {
                    requestBody = {
                        ...requestBody,
                        account_name: tokenData.scope.accounts[0].name
                    };
                }
            }
        }
        
        console.log(`📡 Making ${requestData.method} request to ${requestData.url}`);
        
        const startTime = Date.now();
        const response = await fetch(requestData.url, {
            method: requestData.method,
            headers: headers,
            body: requestBody ? JSON.stringify(requestBody) : undefined
        });
        const endTime = Date.now();
        
        const responseText = await response.text();
        let responseBody;
        try {
            responseBody = JSON.parse(responseText);
        } catch (e) {
            responseBody = responseText;
        }
        
        // Determine success based on API behavior
        const isAPISuccess = response.status === 200 || 
            (response.status === 400 && 
             (responseBody?.error_code === 'MANDATORY_DATA_MISSING' || 
              responseBody?.error_code === 'INVALID_REQUEST_DATA'));
        
        // Generate validation results
        const validation = {
            'Network connectivity': !!response.status,
            'Endpoint exists': response.status !== 404,
            'Authentication works': response.status !== 401,
            'Request structure valid': response.status === 400 && responseBody?.error_code || response.status < 400,
            'Structured API response': responseBody && typeof responseBody === 'object',
            'GP API response format': !!(
                responseBody?.error_code || 
                responseBody?.detailed_error_code ||
                responseBody?.transaction_id ||
                responseBody?.status ||
                responseBody?.merchant_id
            ),
            'Reasonable response time': (endTime - startTime) < 10000,
            'API integration functional': !!response.status && response.status !== 404 && response.status !== 401
        };
        
        // Check if the status code we received is one that's documented
        const documentedCodes = requestData.documentedStatusCodes || [];
        const receivedCodeMatch = documentedCodes.includes(String(response.status));
        
        return {
            statusCode: response.status,
            statusText: response.statusText,
            responseTime: endTime - startTime,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            requestHeaders: headers,
            method: requestData.method,
            url: requestData.url,
            body: responseBody,
            success: isAPISuccess,
            authenticated: !!tokenData.token,
            validation: validation,
            documentedStatusCodes: documentedCodes,
            receivedStatusCodeIsDocumented: receivedCodeMatch,
            analysis: {
                isExpectedFormat: responseBody && typeof responseBody === 'object',
                hasErrorMessage: responseBody && (responseBody.error || responseBody.message || responseBody.error_code),
                responseSize: responseText.length,
                httpStatusFamily: Math.floor(response.status / 100) + 'xx',
                contentType: response.headers.get('content-type') || 'unknown',
                matchesDocumentation: receivedCodeMatch
            }
        };
        
    } catch (error) {
        console.log(`❌ Live API test failed: ${error.message}`);
        return {
            statusCode: null,
            statusText: 'Network Error',
            responseTime: 0,
            body: error.message,
            success: false,
            error: true,
            validation: {
                'Network connectivity': false,
                'Endpoint exists': false,
                'Authentication works': false,
                'Request structure valid': false,
                'Structured API response': false,
                'GP API response format': false,
                'Reasonable response time': false,
                'API integration functional': false
            }
        };
    }
}

// API endpoint to list available result files
app.get('/api/list-results', async (req, res) => {
    try {
        const files = await fs.readdir(__dirname);
        const resultFiles = files
            .filter(f => f.startsWith('extraction-results-') && f.endsWith('.json'))
            .map(f => {
                const timestamp = f.match(/extraction-results-(\d+)\.json/)?.[1];
                const date = timestamp ? new Date(parseInt(timestamp)).toLocaleString() : 'Unknown';
                return { name: f, date };
            })
            .sort((a, b) => b.name.localeCompare(a.name)); // Most recent first
        
        res.json(resultFiles);
    } catch (error) {
        console.error('Error listing result files:', error);
        res.status(500).json({ error: 'Failed to list result files' });
    }
});

// API endpoint to load a specific result file
app.get('/api/load-result/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        
        // Security: only allow extraction-results files
        if (!filename.startsWith('extraction-results-') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        const filePath = path.join(__dirname, filename);
        const data = await fs.readFile(filePath, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Error loading result file:', error);
        res.status(404).json({ error: 'File not found' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 API Scraper Server running at http://localhost:${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    console.log(`🔧 Health check: http://localhost:${PORT}/api/health`);
});

export default app;