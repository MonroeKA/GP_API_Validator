import com.global.api.entities.enums.Environment;
import com.global.api.entities.gpApi.entities.AccessTokenInfo;
import com.global.api.serviceConfigs.GpApiConfig;
import com.global.api.services.GpApiService;

public class SdkVerifier {
    public static void main(String[] args) {
        long startedAt = System.currentTimeMillis();

        try {
            GpApiConfig config = new GpApiConfig();
            config.setAppId(System.getenv("GP_API_APP_ID"));
            config.setAppKey(System.getenv("GP_API_APP_KEY"));
            config.setEnvironment(Environment.TEST);

            AccessTokenInfo accessTokenInfo = GpApiService.generateTransactionKey(config);
            boolean verified = accessTokenInfo != null && accessTokenInfo.getAccessToken() != null;

            printResult(verified, System.currentTimeMillis() - startedAt,
                verified ? "Official Global Payments Java SDK authenticated successfully" : "SDK did not return an access token",
                null);
        } catch (Exception error) {
            printResult(false, System.currentTimeMillis() - startedAt, null, error.getMessage());
        }
    }

    private static void printResult(boolean verified, long responseTime, String message, String error) {
        String detailName = error == null ? "message" : "error";
        String detail = error == null ? message : error;
        System.out.printf(
            "{\"sdk\":\"com.globalpayments:globalpayments-sdk\",\"language\":\"Java\",\"version\":\"15.1.14\",\"verified\":%s,\"environment\":\"TEST\",\"authentication\":\"%s\",\"responseTime\":%d,\"%s\":\"%s\"}%n",
            verified,
            verified ? "successful" : "failed",
            responseTime,
            detailName,
            escapeJson(detail)
        );
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "Unknown SDK error";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n");
    }
}
