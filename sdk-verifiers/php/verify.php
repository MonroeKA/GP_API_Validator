<?php

require_once __DIR__ . '/vendor/autoload.php';

use GlobalPayments\Api\Entities\Enums\Environment;
use GlobalPayments\Api\ServiceConfigs\Gateways\GpApiConfig;
use GlobalPayments\Api\Services\GpApiService;

$startedAt = microtime(true);

try {
    $config = new GpApiConfig();
    $config->appId = getenv('GP_API_APP_ID');
    $config->appKey = getenv('GP_API_APP_KEY');
    $config->environment = Environment::TEST;

    $accessTokenInfo = GpApiService::generateTransactionKey($config);
    $verified = !empty($accessTokenInfo->accessToken);

    echo json_encode([
        'sdk' => 'globalpayments/php-sdk',
        'language' => 'PHP',
        'version' => '14.4.2',
        'verified' => $verified,
        'environment' => 'TEST',
        'authentication' => $verified ? 'successful' : 'failed',
        'responseTime' => (int) round((microtime(true) - $startedAt) * 1000),
        'message' => $verified
            ? 'Official Global Payments PHP SDK authenticated successfully'
            : 'SDK did not return an access token'
    ]);
} catch (Throwable $error) {
    echo json_encode([
        'sdk' => 'globalpayments/php-sdk',
        'language' => 'PHP',
        'version' => '14.4.2',
        'verified' => false,
        'environment' => 'TEST',
        'authentication' => 'failed',
        'responseTime' => (int) round((microtime(true) - $startedAt) * 1000),
        'error' => $error->getMessage()
    ]);
}
