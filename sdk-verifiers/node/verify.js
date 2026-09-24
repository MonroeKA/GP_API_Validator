#!/usr/bin/env node
// Standalone verifier: authenticates with the official Global Payments Node.js SDK
// and prints a single JSON result line, mirroring sdk-verifiers/php/verify.php
// and sdk-verifiers/java/src/main/java/SdkVerifier.java.

import { Environment, GpApiConfig, GpApiService } from 'globalpayments-api';

const startedAt = Date.now();

try {
    const config = new GpApiConfig();
    config.appId = process.env.GP_API_APP_ID;
    config.appKey = process.env.GP_API_APP_KEY;
    config.environment = Environment.Test;

    const accessTokenInfo = await GpApiService.generateTransactionKey(config);
    const verified = !!accessTokenInfo?.accessToken;

    console.log(JSON.stringify({
        sdk: 'globalpayments-api',
        language: 'Node.js',
        version: '3.11.1',
        verified,
        environment: 'TEST',
        authentication: verified ? 'successful' : 'failed',
        responseTime: Date.now() - startedAt,
        message: verified
            ? 'Official Global Payments Node.js SDK authenticated successfully'
            : 'SDK did not return an access token'
    }));
} catch (error) {
    console.log(JSON.stringify({
        sdk: 'globalpayments-api',
        language: 'Node.js',
        version: '3.11.1',
        verified: false,
        environment: 'TEST',
        authentication: 'failed',
        responseTime: Date.now() - startedAt,
        error: error.message
    }));
}
