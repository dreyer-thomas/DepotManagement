import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { claudeCodeCommand, mcpEndpointUrl } from "./labels";

const CODE_SX = { fontFamily: "monospace", fontSize: "0.875rem", overflowWrap: "anywhere" } as const;

/**
 * Empty state of Settings › Verbundene Apps: how to connect Claude. `issuer` is the validated `APP_URL`, or
 * null when it is unset or invalid (then the OAuth/MCP routes answer 503, so it must be set first).
 */
export function ConnectedAppsEmpty({ issuer }: { issuer: string | null }) {
  return (
    <Card>
      <CardContent>
        <Typography sx={{ mb: 1 }}>Noch keine App verbunden.</Typography>
        {issuer === null ? (
          <Typography variant="body2" color="warning.main" sx={{ mb: 1 }}>
            Setze zuerst die Umgebungsvariable APP_URL auf die öffentliche Adresse der App; ohne sie kann sich keine App
            verbinden.
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          In Claude (Desktop, claude.ai, iOS) fügst du einen benutzerdefinierten Connector mit dieser URL hinzu:
        </Typography>
        <Box component="code" sx={{ ...CODE_SX, display: "block", my: 1 }}>
          {mcpEndpointUrl(issuer)}
        </Box>
        <Typography variant="body2" color="text.secondary">
          In Claude Code:
        </Typography>
        <Box component="code" sx={{ ...CODE_SX, display: "block", my: 1 }}>
          {claudeCodeCommand(issuer)}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Danach meldest du dich mit deinem App-Login an und wählst „Erlauben“ – mehr ist nicht nötig.
        </Typography>
      </CardContent>
    </Card>
  );
}
