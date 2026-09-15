const MAX_BEARER_TOKEN_LENGTH = 8_192;

export function extractBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer ([^\s]+)$/i);
  if (!match) return null;
  const token = match[1];
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) return null;
  return token;
}

