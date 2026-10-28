// Discovery documents: RFC 9728 protected-resource metadata and RFC 8414 authorization-server metadata.
import { SUPPORTED_SCOPES } from "./authorize";
import { TOKEN_ENDPOINT_AUTH_METHODS } from "./clients";
import type { McpConfig } from "./config";

export function protectedResourceMetadata(config: McpConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(config: McpConfig) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    scopes_supported: [...SUPPORTED_SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}
