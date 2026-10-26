import Typography from "@mui/material/Typography";

/** Section heading (h2) inside an Overview card; `id` labels the card's section. */
export function CardHeading({ id, children }: { id: string; children: string }) {
  return (
    <Typography id={id} component="h2" variant="subtitle1" sx={{ fontWeight: 600, fontSize: 14, mb: 1 }}>
      {children}
    </Typography>
  );
}
