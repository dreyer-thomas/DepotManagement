import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";

/** A KPI tile: label, figure and an optional caption, with a colored top border. */
export function Kpi({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <Card sx={{ borderTop: 4, borderTopColor: color, minWidth: 0 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="figureKpi" component="p" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
          {value}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary">
            {note}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
