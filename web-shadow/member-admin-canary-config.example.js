// Example only. Do not commit a real access token.
window.MEICARE_SHADOW_CONFIG = {
  gatewayUrl: "https://YOUR_SHADOW_GATEWAY.example",
  organizationId: "YOUR_ORGANIZATION_UUID",
  accessToken: "INJECT_AT_RUNTIME_OR_USE_EXISTING_SESSION",

  // Fail-closed default. Change to V4_CANARY only in an approved canary deployment.
  memberAdminMode: "OFF",
  memberAdminFunctionUrl: "https://sgxufmcsnveyyddazwuk.supabase.co/functions/v1/meicare-member-admin-v4",

  // Optional navigation-only rollback target. The V4 canary controller never writes to it.
  legacyMemberAdminUrl: "",
};
