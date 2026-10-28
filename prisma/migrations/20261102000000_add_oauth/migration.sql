-- Adds OAuthClient, OAuthGrant and OAuthToken (story 9-4, owned by the mcp module).
-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "grantTypes" TEXT NOT NULL,
    "tokenEndpointAuthMethod" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "lastUsedAt" TEXT,
    "revokedAt" TEXT,
    CONSTRAINT "OAuthGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "grantId" TEXT,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "codeChallenge" TEXT,
    "redirectUri" TEXT,
    "expiresAt" TEXT NOT NULL,
    "consumedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "OAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- CreateIndex
CREATE INDEX "OAuthGrant_clientId_idx" ON "OAuthGrant"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_hash_key" ON "OAuthToken"("hash");

-- CreateIndex
CREATE INDEX "OAuthToken_grantId_idx" ON "OAuthToken"("grantId");

-- CreateIndex
CREATE INDEX "OAuthToken_clientId_idx" ON "OAuthToken"("clientId");

-- CreateIndex
CREATE INDEX "OAuthToken_expiresAt_idx" ON "OAuthToken"("expiresAt");

