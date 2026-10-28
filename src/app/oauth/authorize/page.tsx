import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/modules/auth";
import { AUTHORIZE_PARAM_NAMES, readMcpConfig, validateAuthorizeRequest } from "@/modules/mcp";
import { ConsentForm } from "./ConsentForm";
import { authorizePath, ERROR_PAGE_MESSAGES, MAX_AUTHORIZE_URL_LENGTH, NOT_CONFIGURED_MESSAGE, TOO_LONG_MESSAGE } from "./messages";

export const metadata: Metadata = { title: "App verbinden" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="main" sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
      <Card sx={{ width: "100%", maxWidth: 440 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" component="p" sx={{ fontWeight: 600, color: "primary.main", mb: 1 }}>
            DepotManagement
          </Typography>
          <Typography variant="pageTitle" component="h1" sx={{ mb: 2 }}>
            {title}
          </Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <Frame title="Verbindung nicht möglich">
      <Typography role="alert">{message}</Typography>
    </Frame>
  );
}

/**
 * OAuth consent page (story 9.4), outside the app shell like the login. An unknown client or redirect URI
 * shows an error here (never a redirect); other request errors redirect to the client. Without a session
 * the login comes first and returns here.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const config = readMcpConfig(process.env);
  if (!config) {
    console.error("OAuth/MCP: APP_URL is missing or invalid");
    return <ErrorPage message={NOT_CONFIGURED_MESSAGE} />;
  }
  const path = authorizePath(params);
  if (path.length > MAX_AUTHORIZE_URL_LENGTH) return <ErrorPage message={TOO_LONG_MESSAGE} />;
  const validation = await validateAuthorizeRequest(params, config);
  if (validation.kind === "error-page") return <ErrorPage message={ERROR_PAGE_MESSAGES[validation.reason]} />;
  if (validation.kind === "redirect") redirect(validation.url);
  if (!(await getSession())) redirect(`/login?next=${encodeURIComponent(path)}`);

  const formParams: Record<string, string> = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const value = params[name];
    if (typeof value === "string") formParams[name] = value;
  }
  const { clientName, redirectHost, portfolioReadRequested } = validation.request;
  return (
    <Frame title="App verbinden">
      <Typography sx={{ mb: 1, overflowWrap: "anywhere" }}>„{clientName}“ möchte deine Watchlists lesen und ändern.</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 3, overflowWrap: "anywhere" }}>
        Weiterleitung an {redirectHost}
      </Typography>
      <ConsentForm params={formParams} offerPortfolioRead={portfolioReadRequested} />
    </Frame>
  );
}
