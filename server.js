#!/usr/bin/env node
// Backend server for the API scraper frontend

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractFromUrl, testAllSnippets, verifyAllGlobalPaymentsSdks } from './lib/pipeline.js';

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
            
            // Add token permissions to test results for display
            if (testResults) {
                try {
                    const tokenFile = path.join(process.cwd(), 'gp-access-token.json');
                    const tokenData = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
                    testResults.accountPermissions = tokenData.scope;
                } catch (error) {
                    console.log('⚠️  Could not load token permissions:', error.message);
                }
            }
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

app.get('/api/sdk-verification', async (req, res) => {
    try {
        const sdkVerifications = await verifyAllGlobalPaymentsSdks();
        res.json({ sdkVerifications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


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
