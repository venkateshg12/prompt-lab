export enum appErrorCode {
    InvalidAccessToken = "InvalidAccessToken",
    Forbidden = "ForbiddenAccess",
    TokenExpired = "TOKEN_EXPIRED",
    GmailNotConfigured = "GMAIL_NOT_CONFIGURED",
    GmailAuthInvalid = "GMAIL_AUTH_INVALID",
    GmailSendFailed = "GMAIL_SEND_FAILED",
    ValidationError = "VALIDATION_ERROR",
    QuotaExceeded = "QUOTA_EXCEEDED",
    TooManyRequests = "TOO_MANY_REQUESTS",
    // Later phases append their own codes here: PromptFrozen (13), ProviderNotConfigured (14), ...
}
