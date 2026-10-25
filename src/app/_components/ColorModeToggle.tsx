"use client";

import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlined from "@mui/icons-material/SettingsBrightnessOutlined";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useColorScheme } from "@mui/material/styles";
import { useId, useState } from "react";

type Mode = "system" | "light" | "dark";

const options: { mode: Mode; label: string; Icon: typeof LightModeOutlined }[] = [
  { mode: "system", label: "System", Icon: SettingsBrightnessOutlined },
  { mode: "light", label: "Hell", Icon: LightModeOutlined },
  { mode: "dark", label: "Dunkel", Icon: DarkModeOutlined },
];

/** "Darstellung" menu: System / Hell / Dunkel. MUI persists the choice in localStorage. */
export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  // `mode` is undefined until mounted; show the neutral "System" icon meanwhile.
  const current = options.find((option) => option.mode === mode) ?? options[0];
  const CurrentIcon = current.Icon;
  const open = Boolean(anchor);

  return (
    <>
      <IconButton
        color="inherit"
        size="large"
        aria-label={`Darstellung: ${current.label}`}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <CurrentIcon />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ list: { "aria-label": "Darstellung" } }}
      >
        {options.map(({ mode: value, label, Icon }) => (
          <MenuItem
            key={value}
            selected={mode === value}
            role="menuitemradio"
            aria-checked={mode === value}
            sx={{ minHeight: 44 }}
            onClick={() => {
              setMode(value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
