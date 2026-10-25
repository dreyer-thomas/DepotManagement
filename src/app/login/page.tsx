import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, safeReturnUrl } from "@/modules/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Anmelden" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Login page, rendered without the navigation shell. */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeReturnUrl(first(params.next));
  if (await getSession()) {
    redirect(next);
  }
  const expired = first(params.expired) === "1";

  return (
    <Box
      component="main"
      sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
    >
      <Card sx={{ width: "100%", maxWidth: 400 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" component="p" sx={{ fontWeight: 600, color: "primary.main", mb: 1 }}>
            DepotManagement
          </Typography>
          <Typography variant="pageTitle" component="h1" sx={{ mb: 2 }}>
            Anmelden
          </Typography>
          <LoginForm next={next} expired={expired} />
        </CardContent>
      </Card>
    </Box>
  );
}
