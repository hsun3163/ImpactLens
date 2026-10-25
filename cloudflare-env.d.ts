declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    MCP_EVENTS_CALLBACK_ORIGIN?: string;
    BUCKET?: R2Bucket;
    TPW_ADMIN_USER_IDS?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_PHONE_NUMBER?: string;
    TWILIO_WEBHOOK_URL?: string;
  }
}
